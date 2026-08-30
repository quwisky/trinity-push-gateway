import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const docsRoot = path.resolve(import.meta.dirname, '..');
const outputDirectory = path.resolve(
  process.env.TRINITY_DOCS_OUT_DIR ??
    path.resolve(docsRoot, '../dist/docs/push-gateway-docs'),
);
if (outputDirectory === path.parse(outputDirectory).root) {
  throw new Error('Refusing to build documentation into a filesystem root.');
}

const result = spawnSync(
  path.resolve(docsRoot, '../node_modules/.bin/vitepress'),
  ['build', '.', '--outDir', outputDirectory],
  {
    cwd: docsRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      TRINITY_DOCS_BASE:
        process.env.TRINITY_DOCS_BASE ?? '/trinity-push-gateway/next/',
      TRINITY_DOCS_CHANNEL: process.env.TRINITY_DOCS_CHANNEL ?? 'next',
      TRINITY_DOCS_SOURCE_REF: process.env.TRINITY_DOCS_SOURCE_REF ?? 'master',
    },
    stdio: 'inherit',
  },
);
if (result.error !== undefined) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
