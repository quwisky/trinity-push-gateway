import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const applicationRoot = path.join(workspaceRoot, 'apps/push-gateway');
const migrationsRoot = path.join(applicationRoot, 'migrations');
const initialMigration = path.join(migrationsRoot, '0001_initial.sql');
const initialMigrationHash =
  '9c758e463343a03c2b8e113dcb50e66cbc632d74a4dbb1f3cb4be76a15dee13d';
const configs = ['drizzle.d1.config.ts', 'drizzle.bun.config.ts'];
const destructiveMigrationPatterns = [
  /\bDROP\s+(?:TABLE|COLUMN)\b/iu,
  /\bRENAME\s+(?:TO|COLUMN)\b/iu,
  /\bCREATE\s+TABLE\s+["'`\[]?__new/iu,
  /\bPRAGMA\s+foreign_keys\s*=\s*(?:OFF|0)\b/iu,
];

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (
    result.status !== 0 ||
    /(?:\berror\b|\bfailed\b|exception|\[x\]|✖)/iu.test(output)
  ) {
    throw new Error(
      `${command} ${arguments_.join(' ')} failed:\n${output.trim()}`,
    );
  }
  return output;
}

async function manifest(directory) {
  const files = [];
  async function visit(current, relative) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const entryPath = path.join(current, entry.name);
      const relativePath = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, relativePath);
      } else if (entry.isFile()) {
        const contents = await readFile(entryPath);
        files.push({
          hash: createHash('sha256').update(contents).digest('hex'),
          path: relativePath.split(path.sep).join('/'),
        });
      } else {
        throw new Error(`Unsupported migration artifact: ${relativePath}`);
      }
    }
  }
  await visit(directory, '');
  return files;
}

async function checkGenerationConfiguration() {
  const wrapperContents = await Promise.all(
    configs.map((config) =>
      readFile(path.join(applicationRoot, config), 'utf8'),
    ),
  );
  if (
    new Set(wrapperContents).size !== 1 ||
    !wrapperContents[0]?.includes(
      "gatewayDrizzleConfig as default } from './drizzle.shared.config'",
    )
  ) {
    throw new Error(
      'D1 and Bun must re-export the same generation-only Drizzle configuration.',
    );
  }
}

async function checkForbiddenAutomation() {
  const sourceRoot = path.join(applicationRoot, 'src');
  const sourceFiles = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) {
        sourceFiles.push(entryPath);
      }
    }
  }
  await visit(sourceRoot);
  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');
    if (/drizzle-orm\/(?:d1|bun-sqlite)\/migrator['"]/u.test(source)) {
      throw new Error(
        `Runtime Drizzle migrators are forbidden: ${path.relative(workspaceRoot, sourceFile)}`,
      );
    }
  }

  const automationFiles = [
    path.join(workspaceRoot, 'package.json'),
    path.join(applicationRoot, 'project.json'),
  ];
  const workflowRoot = path.join(workspaceRoot, '.github/workflows');
  for (const entry of await readdir(workflowRoot, { withFileTypes: true })) {
    if (entry.isFile()) {
      automationFiles.push(path.join(workflowRoot, entry.name));
    }
  }
  for (const automationFile of automationFiles) {
    const source = await readFile(automationFile, 'utf8');
    if (/drizzle-kit\s+push\b/iu.test(source)) {
      throw new Error(
        `drizzle-kit push is forbidden in automation: ${path.relative(workspaceRoot, automationFile)}`,
      );
    }
  }
}

async function checkMigrationPolicy() {
  const sqlFiles = (await readdir(migrationsRoot))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  if (sqlFiles[0] !== '0001_initial.sql') {
    throw new Error(
      'The canonical migration lineage must start at 0001_initial.sql.',
    );
  }

  const initialSql = await readFile(initialMigration);
  const actualInitialHash = createHash('sha256')
    .update(initialSql)
    .digest('hex');
  if (actualInitialHash !== initialMigrationHash) {
    throw new Error(
      '0001_initial.sql changed after its Drizzle baseline adoption.',
    );
  }
  if (
    (initialSql.toString('utf8').match(/\) WITHOUT ROWID;/gu) ?? []).length !==
    2
  ) {
    throw new Error('0001_initial.sql must retain both WITHOUT ROWID tables.');
  }

  const journal = JSON.parse(
    await readFile(path.join(migrationsRoot, 'meta/_journal.json'), 'utf8'),
  );
  const journalFiles = journal.entries.map(({ tag }) => `${tag}.sql`);
  if (JSON.stringify(journalFiles) !== JSON.stringify(sqlFiles)) {
    throw new Error(
      'Drizzle journal entries must exactly match canonical SQL files.',
    );
  }

  for (let index = 0; index < sqlFiles.length; index += 1) {
    const name = sqlFiles[index];
    const journalEntry = journal.entries[index];
    if (
      journalEntry?.idx !== index + 1 ||
      journalEntry.tag !== name.slice(0, -'.sql'.length) ||
      journalEntry.breakpoints !== false
    ) {
      throw new Error(`${name} has inconsistent Drizzle journal metadata.`);
    }
    const snapshot = path.join(
      migrationsRoot,
      'meta',
      `${name.slice(0, 4)}_snapshot.json`,
    );
    await readFile(snapshot);
    if (index > 0) {
      const previous = sqlFiles[index - 1];
      const sqlText = await readFile(path.join(migrationsRoot, name), 'utf8');
      if (!sqlText.startsWith(`-- minimum-reader: ${previous}\n`)) {
        throw new Error(
          `${name} must declare the immediately preceding migration as its minimum reader.`,
        );
      }
      if (
        destructiveMigrationPatterns.some((pattern) => pattern.test(sqlText))
      ) {
        throw new Error(
          `${name} contains destructive or table-rebuild SQL; migrations must remain expand-first.`,
        );
      }
    }
  }
}

await checkGenerationConfiguration();
await checkForbiddenAutomation();
await checkMigrationPolicy();

for (const config of configs) {
  run('pnpm', [
    'exec',
    'drizzle-kit',
    'check',
    '--config',
    `apps/push-gateway/${config}`,
  ]);
}

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'trinity-drizzle-check-'),
);
try {
  const expectedManifest = await manifest(migrationsRoot);
  for (const config of configs) {
    const runtime = config.includes('.d1.') ? 'd1' : 'bun';
    const temporaryMigrations = path.join(temporaryRoot, runtime);
    await cp(migrationsRoot, temporaryMigrations, { recursive: true });
    const output = run(
      'pnpm',
      [
        'exec',
        'drizzle-kit',
        'generate',
        '--config',
        `apps/push-gateway/${config}`,
      ],
      {
        env: {
          ...process.env,
          TRINITY_DRIZZLE_MIGRATIONS_OUT: path.relative(
            workspaceRoot,
            temporaryMigrations,
          ),
        },
      },
    );
    if (!output.includes('No schema changes, nothing to migrate')) {
      throw new Error(`${config} generated an uncommitted schema change.`);
    }
    const actualManifest = await manifest(temporaryMigrations);
    if (JSON.stringify(actualManifest) !== JSON.stringify(expectedManifest)) {
      throw new Error(`${config} changed the committed migration lineage.`);
    }
  }
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

console.info(
  `Migration lineage: ${configs.length} runtime configs, ` +
    `${(await manifest(migrationsRoot)).length} reviewed artifacts, no drift.`,
);
