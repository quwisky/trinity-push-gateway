import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const migrationsRoot = path.join(workspaceRoot, 'apps/push-gateway/migrations');
const nameIndex = process.argv.findIndex(
  (argument) => argument === '--name' || argument.startsWith('--name='),
);
const nameArgument = process.argv[nameIndex];
const name = nameArgument?.includes('=')
  ? nameArgument.slice(nameArgument.indexOf('=') + 1)
  : process.argv[nameIndex + 1];

if (name === undefined || !/^[a-z][a-z0-9_-]*$/u.test(name)) {
  throw new Error(
    'Provide a lowercase migration name with --name, for example --name=add_delivery_note.',
  );
}

function run(arguments_) {
  const result = spawnSync('pnpm', arguments_, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (
    result.status !== 0 ||
    /(?:\berror\b|\bfailed\b|exception|\[x\]|✖)/iu.test(output)
  ) {
    throw new Error(`Migration command failed with status ${result.status}.`);
  }
}

function sqlFiles() {
  return readdirSync(migrationsRoot)
    .filter((fileName) => /^\d{4}_.+\.sql$/u.test(fileName))
    .sort();
}

const before = sqlFiles();
run([
  'exec',
  'drizzle-kit',
  'generate',
  '--config',
  'apps/push-gateway/drizzle.d1.config.ts',
]);

const created = sqlFiles().filter((fileName) => !before.includes(fileName));
if (created.length > 1) {
  throw new Error(
    `Expected at most one generated migration, found ${created.length}.`,
  );
}
if (created[0] !== undefined) {
  const previous = before.at(-1);
  if (previous === undefined) {
    throw new Error('The adopted 0001 migration must exist before generation.');
  }
  const generatedName = created[0];
  const renamedName = `${generatedName.slice(0, 4)}_${name}.sql`;
  const generatedPath = path.join(migrationsRoot, generatedName);
  const renamedPath = path.join(migrationsRoot, renamedName);
  const journalPath = path.join(migrationsRoot, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const entry = journal.entries.at(-1);
  if (entry?.tag !== generatedName.slice(0, -'.sql'.length)) {
    throw new Error('Generated SQL and Drizzle journal entry do not agree.');
  }

  if (renamedName !== generatedName) {
    if (existsSync(renamedPath)) {
      throw new Error(`Migration already exists: ${renamedName}`);
    }
    renameSync(generatedPath, renamedPath);
  }
  writeFileSync(
    renamedPath,
    `-- minimum-reader: ${previous}\n${readFileSync(renamedPath, 'utf8')}`,
  );
  entry.tag = renamedName.slice(0, -'.sql'.length);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
}

run([
  'exec',
  'drizzle-kit',
  'generate',
  '--config',
  'apps/push-gateway/drizzle.bun.config.ts',
]);

run(['exec', 'node', 'apps/push-gateway/scripts/check-migrations.mjs']);
