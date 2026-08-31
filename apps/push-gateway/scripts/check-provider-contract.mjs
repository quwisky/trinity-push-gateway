import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const providerRoot = path.join(workspaceRoot, 'apps/push-gateway/provider-e2e');

const [
  workflow,
  project,
  pocketCompose,
  authentikCompose,
  blueprint,
  preparation,
] = await Promise.all([
  readFile(
    path.join(workspaceRoot, '.github/workflows/provider-compatibility.yml'),
    'utf8',
  ),
  readFile(path.join(workspaceRoot, 'apps/push-gateway/project.json'), 'utf8'),
  readFile(path.join(providerRoot, 'compose.pocket-id.yml'), 'utf8'),
  readFile(path.join(providerRoot, 'compose.authentik.yml'), 'utf8'),
  readFile(path.join(providerRoot, 'authentik-blueprint.yaml'), 'utf8'),
  readFile(path.join(providerRoot, 'prepare-authentik.mjs'), 'utf8'),
]);

function requireContract(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const projectConfiguration = JSON.parse(project);

for (const [name, compose, image] of [
  [
    'Pocket ID',
    pocketCompose,
    'ghcr.io/pocket-id/pocket-id:v2.14.0@sha256:01540977dcf4c7b41b1159f34d68e4632f2658d62790e460ca65a42722b13c4a',
  ],
  [
    'Authentik',
    authentikCompose,
    'ghcr.io/goauthentik/server:2026.8.0@sha256:7421753cfea67e89a6d295a1f0173ccea3866b33768c88dad90453b151cdcfd5',
  ],
  [
    'PostgreSQL',
    authentikCompose,
    'postgres:16.10-alpine@sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297',
  ],
]) {
  requireContract(
    compose.includes(`image: ${image}`),
    `${name} must use the reviewed compatibility image ${image}.`,
  );
  requireContract(
    !/^\s*image:\s+\S+:(?:latest|edge)\s*$/gmu.test(compose),
    `${name} compatibility services must not use moving tags.`,
  );
}

for (const required of [
  'include_claims_in_id_token: true',
  'matching_mode: strict',
  'http://127.0.0.1:3000/admin/auth/callback',
  'http://127.0.0.1:3000/admin/',
  'gateway-operators',
  'gateway-denied',
]) {
  requireContract(
    blueprint.includes(required),
    `The Authentik blueprint is missing ${required}.`,
  );
}

for (const required of [
  "cron: '23 3 * * 2'",
  'pnpm nx run push-gateway:test-oidc-provider --skipNxCache',
  'browser-authentik-gate.mjs',
  'Prove provider failure isolation',
  'release-gates:',
  'pocket-id-provider-gate-',
  'authentik-visual-proof-',
  'push-gateway:provider-gate-pocket-id --skipNxCache',
  'push-gateway:provider-gate-pocket-id-cleanup --skipNxCache',
]) {
  requireContract(
    workflow.includes(required),
    `The provider workflow is missing ${required}.`,
  );
}
requireContract(
  workflow.includes("github.base_ref }}' == 'master'") ||
    workflow.includes("github.base_ref }}\" == 'master'"),
  'Integration pull requests to master must select Authentik.',
);
requireContract(
  workflow.includes('PROVIDER_GATE_WORK_DIRECTORY:') &&
    workflow.includes('rm -rf -- "$RUNNER_TEMP/authentik-gate"'),
  'Disposable provider credentials must be removed during cleanup.',
);

for (const [target, command] of [
  [
    'provider-gate-pocket-id',
    'node provider-e2e/run-provider-gate.mjs pocket-id run',
  ],
  [
    'provider-gate-pocket-id-cleanup',
    'node provider-e2e/run-provider-gate.mjs pocket-id cleanup',
  ],
  ['test-provider-gate-lifecycle', 'node --test provider-e2e/*.test.mjs'],
]) {
  requireContract(
    projectConfiguration.targets?.[target]?.options?.command === command,
    `The push-gateway project target ${target} is not wired to its reviewed command.`,
  );
}
requireContract(
  projectConfiguration.targets?.['check-bun']?.dependsOn?.includes(
    'test-provider-gate-lifecycle',
  ),
  'The Bun validation gate must execute the provider lifecycle and adapter tests.',
);

for (const required of [
  "import { randomBytes } from 'node:crypto'",
  'randomBytes(bytes)',
  '::add-mask::',
  'mode: 0o600',
  'gateway.env',
  'provider.env',
  'browser-state.json',
]) {
  requireContract(
    preparation.includes(required),
    `Provider credential preparation is missing ${required}.`,
  );
}

console.info(
  'Provider contract: deterministic suite, deep Pocket ID lifecycle, pinned real providers, ephemeral credentials, browser proof, outage isolation, and release gate.',
);
