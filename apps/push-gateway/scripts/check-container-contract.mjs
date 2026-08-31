import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUSH_GATEWAY_CONFIGURATION_CATALOG } from '../src/configuration-catalog.ts';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const gatewayRoot = path.join(workspaceRoot, 'apps/push-gateway');

const [
  dockerfile,
  dockerignore,
  compose,
  adminCompose,
  selfHostExample,
  adminExample,
] = await Promise.all([
  readFile(path.join(gatewayRoot, 'Dockerfile'), 'utf8'),
  readFile(path.join(workspaceRoot, '.dockerignore'), 'utf8'),
  readFile(path.join(workspaceRoot, 'compose.yml'), 'utf8'),
  readFile(path.join(workspaceRoot, 'compose.admin.yml'), 'utf8'),
  readFile(path.join(workspaceRoot, '.env.self-host.example'), 'utf8'),
  readFile(path.join(workspaceRoot, '.env.self-host-admin.example'), 'utf8'),
]);

function requireContract(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const deploymentSources = [
  compose,
  adminCompose,
  selfHostExample,
  adminExample,
];
const deploymentNames = new Set(
  deploymentSources.flatMap(
    (source) => source.match(/\bTRINITY_PUSH_GATEWAY_[A-Z][A-Z0-9_]*/gu) ?? [],
  ),
);
for (const name of deploymentNames) {
  const entry = PUSH_GATEWAY_CONFIGURATION_CATALOG.references.find(
    (candidate) => candidate.name === name,
  );
  requireContract(
    entry !== undefined &&
      (entry.runtimes.includes('bun') || entry.runtimes.includes('compose')),
    `Deployment input ${name} is not owned by the configuration catalog.`,
  );
}

function catalogDefault(name) {
  const defaultValue = PUSH_GATEWAY_CONFIGURATION_CATALOG.references.find(
    (entry) => entry.name === name,
  )?.defaultValue;
  requireContract(
    defaultValue !== undefined,
    `The configuration catalog has no default for ${name}.`,
  );
  return defaultValue;
}

function composeFallback(name) {
  return `\${${name}:-${catalogDefault(name)}}`;
}

const runtimeMarker =
  'FROM oven/bun:1.4.0-slim@sha256:e0ee68d16ccb9927bf02aa7dd8fd4bf3369ee6d46da04faa72b05ce8bfd135f6 AS runtime';
const runtimeIndex = dockerfile.indexOf(runtimeMarker);
requireContract(runtimeIndex >= 0, 'The pinned Bun runtime stage is missing.');
const buildStages = dockerfile.slice(0, runtimeIndex);
const runtimeStage = dockerfile.slice(runtimeIndex);

requireContract(
  /FROM dependencies AS admin-ui-build/u.test(buildStages) &&
    /RUN pnpm nx run push-gateway-ui:build:production --skipNxCache/u.test(
      buildStages,
    ),
  'The image must build the production Push Gateway UI in its Node/pnpm stage.',
);
requireContract(
  /bun build .*--target bun --minify --sourcemap=none/u.test(buildStages),
  'The production Bun bundle must be minified with source maps explicitly disabled.',
);
requireContract(
  /COPY --from=admin-ui-build --chown=bun:bun \/app\/dist\/apps\/push-gateway-ui\/browser\/ \/app\/admin\//u.test(
    runtimeStage,
  ),
  'The runtime must copy only the production browser directory.',
);
requireContract(
  /COPY --chown=bun:bun apps\/push-gateway\/admin-migrations\/\*\.sql \/app\/admin-migrations\//u.test(
    runtimeStage,
  ),
  'The runtime must copy only reviewed administration SQL migrations.',
);
for (const forbidden of [
  'node_modules',
  'package.json',
  'pnpm-lock.yaml',
  '/app/src',
  '*.map',
]) {
  requireContract(
    !runtimeStage.includes(forbidden),
    `The final runtime stage contains forbidden build input: ${forbidden}.`,
  );
}
requireContract(
  !/^COPY[^\n]*\s\/app\/(?:dist|src)\/?\s*$/imu.test(runtimeStage),
  'The final runtime stage must not copy build output or source trees as destinations.',
);
requireContract(
  /USER 1000:1000/u.test(runtimeStage) &&
    /VOLUME \["\/data"\]/u.test(runtimeStage),
  'The final image must retain UID/GID 1000 and the /data volume.',
);

for (const ignored of ['.git', '.github', 'dist', 'node_modules', 'secrets']) {
  requireContract(
    dockerignore.split(/\r?\n/u).includes(ignored),
    `Docker context must ignore ${ignored}.`,
  );
}

requireContract(
  !compose.includes('TRINITY_PUSH_GATEWAY_ADMIN_ENABLED'),
  'The base Compose deployment must remain administration-disabled without new inputs.',
);
for (const required of [
  'read_only: true',
  'cap_drop:',
  '- ALL',
  'no-new-privileges:true',
  'gateway-data:/data',
]) {
  requireContract(
    compose.includes(required),
    `The base Compose deployment is missing ${required}.`,
  );
}
requireContract(
  /user: ['"]1000:1000['"]/u.test(compose),
  'The base Compose deployment must pin UID/GID 1000.',
);
for (const required of [
  `ghcr.io/quwisky/trinity-push-gateway:${composeFallback(
    'TRINITY_PUSH_GATEWAY_VERSION',
  )}`,
  `127.0.0.1:${composeFallback(
    'TRINITY_PUSH_GATEWAY_HOST_PORT',
  )}:${composeFallback('TRINITY_PUSH_GATEWAY_PORT')}`,
  `TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER: ${composeFallback(
    'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER',
  )}`,
  `TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS: ${composeFallback(
    'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS',
  )}`,
]) {
  requireContract(
    compose.includes(required),
    `The base Compose deployment does not use the catalog default in ${required}.`,
  );
}
for (const required of [
  'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
  'TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN',
  `TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: ${catalogDefault(
    'TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH',
  )}`,
  `TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY: ${catalogDefault(
    'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY',
  )}`,
  `TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM: ${composeFallback(
    'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM',
  )}`,
  `TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: ${composeFallback(
    'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES',
  )}`,
  `TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD: ${composeFallback(
    'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
  )}`,
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE: /run/secrets/admin_oidc_client_secret',
  'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: /run/secrets/admin_session_secret',
]) {
  requireContract(
    adminCompose.includes(required),
    `The administration Compose override is missing ${required}.`,
  );
}
for (const [source, required] of [
  [
    selfHostExample,
    `TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER=${catalogDefault(
      'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER',
    )}`,
  ],
  [
    selfHostExample,
    `TRINITY_PUSH_GATEWAY_HOST_PORT=${catalogDefault(
      'TRINITY_PUSH_GATEWAY_HOST_PORT',
    )}`,
  ],
  [
    selfHostExample,
    `TRINITY_PUSH_GATEWAY_PORT=${catalogDefault('TRINITY_PUSH_GATEWAY_PORT')}`,
  ],
  [
    adminExample,
    `TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM=${catalogDefault(
      'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM',
    )}`,
  ],
  [
    adminExample,
    `TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES=${catalogDefault(
      'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES',
    )}`,
  ],
  [
    adminExample,
    `TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD=${catalogDefault(
      'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
    )}`,
  ],
  [
    adminExample,
    'TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN=https://push.example.com',
  ],
  [
    adminExample,
    'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD=client_secret_post',
  ],
]) {
  requireContract(
    source.includes(required),
    `The self-hosting environment examples are missing ${required}.`,
  );
}

const migrationEntries = await readdir(
  path.join(gatewayRoot, 'admin-migrations'),
  { withFileTypes: true },
);
const migrationNames = migrationEntries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort();
requireContract(
  migrationNames.length > 0 &&
    migrationNames.every((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name)),
  'Administration image migrations must be reviewed, ordered SQL files.',
);

console.info(
  `Container contract: production UI only, ${migrationNames.length} administration migrations, opt-in Compose override, and no new disabled-mode inputs.`,
);
