#!/usr/bin/env node
// Deploys the Worker with the KV namespace ID and Custom Domain taken from the environment:
//
//   KV_NAMESPACE_ID=<id> GATEWAY_DOMAIN=push.example.org pnpm exec nx run gateway:deploy
//
// CI passes both from GitHub repository variables. Writes a git-ignored
// wrangler.deploy.jsonc next to wrangler.jsonc (so relative paths such as `main` still
// resolve), deploys with it, and removes it again. Extra arguments go to wrangler deploy.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DeployConfigError,
  readDeployInputs,
  renderDeployConfig,
} from './deploy-config.ts';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const generated = join(projectRoot, 'wrangler.deploy.jsonc');

let inputs;
let config;
try {
  inputs = readDeployInputs(process.env);
  config = renderDeployConfig(
    readFileSync(join(projectRoot, 'wrangler.jsonc'), 'utf8'),
    inputs.kvNamespaceId,
  );
} catch (error) {
  if (error instanceof DeployConfigError) {
    console.error(`deploy: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

writeFileSync(generated, config);
let status;
try {
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'deploy',
      '--config',
      'wrangler.deploy.jsonc',
      '--domain',
      inputs.domain,
      ...process.argv.slice(2),
    ],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  status = result.error ? 1 : (result.status ?? 1);
  if (result.error) console.error(`deploy: ${result.error.message}`);
} finally {
  rmSync(generated, { force: true });
}
process.exit(status);
