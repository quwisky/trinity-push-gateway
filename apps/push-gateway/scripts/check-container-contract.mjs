import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { PUSH_GATEWAY_CONFIGURATION_CATALOG } from '../src/configuration-catalog.ts';
import { loadAdministrationConfiguration } from '../src/configuration-catalog/administration.ts';
import { loadBunRuntimeConfiguration } from '../src/configuration-catalog/bun.ts';
import { trustedProxyConfigurationValid } from '../src/bun/client-address.ts';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const gatewayRoot = path.join(workspaceRoot, 'apps/push-gateway');

const [dockerfile, dockerignore] = await Promise.all([
  readFile(path.join(gatewayRoot, 'Dockerfile'), 'utf8'),
  readFile(path.join(workspaceRoot, '.dockerignore'), 'utf8'),
]);

function requireContract(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function catalogDefault(name) {
  const defaultValue =
    PUSH_GATEWAY_CONFIGURATION_CATALOG.reference(name)?.defaultValue;
  requireContract(
    defaultValue !== undefined,
    `The configuration catalog has no default for ${name}.`,
  );
  return defaultValue;
}

const cleanEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !name.startsWith('TRINITY_PUSH_GATEWAY_'),
  ),
);

function resolveCompose({ administration, examples }) {
  const arguments_ = ['compose'];
  if (examples) {
    arguments_.push('--env-file', '.env.self-host.example');
    if (administration) {
      arguments_.push('--env-file', '.env.self-host-admin.example');
    }
  }
  arguments_.push('-f', 'compose.yml');
  if (administration) {
    arguments_.push('-f', 'compose.admin.yml');
  }
  arguments_.push('config', '--format', 'json');

  const environment = examples
    ? cleanEnvironment
    : {
        ...cleanEnvironment,
        TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'ovh.qwky.trinity.android',
        TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'ovh.qwky.trinity.ios',
        ...(administration
          ? {
              TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: 'trinity-push-gateway',
              TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: 'https://id.example.com',
              TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP:
                'push-gateway-operators',
              TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN:
                'https://push.example.com',
            }
          : {}),
      };
  const resolved = spawnSync('docker', arguments_, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    env: environment,
  });
  requireContract(
    resolved.status === 0,
    `Docker Compose could not resolve the deployment contract: ${resolved.stderr}`,
  );
  try {
    return JSON.parse(resolved.stdout);
  } catch {
    throw new Error('Docker Compose did not return its resolved JSON model.');
  }
}

function gatewayService(configuration) {
  const service = configuration.services?.gateway;
  requireContract(service !== undefined, 'The gateway service is missing.');
  return service;
}

function assertCatalogEnvironment(environment) {
  for (const name of Object.keys(environment)) {
    const reference = PUSH_GATEWAY_CONFIGURATION_CATALOG.reference(name);
    requireContract(
      reference?.runtimes.includes('bun') === true,
      `Resolved Bun input ${name} is not owned by the configuration catalog.`,
    );
  }
}

function assertSecretFiles(configuration, expectations, label) {
  for (const [secretName, expectedFile] of expectations) {
    requireContract(
      configuration.secrets?.[secretName]?.file.endsWith(expectedFile) === true,
      `The ${label} must resolve ${secretName} from ${expectedFile}.`,
    );
  }
}

function readFixtureSecret(filePath) {
  if (filePath.endsWith('/fcm_client_email')) {
    return 'gateway@example.test';
  }
  if (filePath.endsWith('/fcm_private_key')) {
    return 'test-private-key';
  }
  if (filePath.endsWith('/fcm_project_id')) {
    return 'test-project';
  }
  if (filePath.endsWith('/fingerprint_key')) {
    return 'f'.repeat(32);
  }
  if (filePath.endsWith('/admin_oidc_client_secret')) {
    return 'test-oidc-client-secret';
  }
  if (filePath.endsWith('/admin_session_secret')) {
    return 's'.repeat(32);
  }
  throw new Error(`Unexpected deployment secret path: ${filePath}`);
}

function loadResolvedBunConfiguration(environment) {
  return loadBunRuntimeConfiguration(environment, {
    readFile: readFixtureSecret,
    trustedProxyConfigurationValid,
  });
}

function loadResolvedAdministration(environment) {
  return loadAdministrationConfiguration(environment, {
    readFile: readFixtureSecret,
    sha256: (value) => createHash('sha256').update(value).digest('hex'),
  });
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

const baseDefaults = resolveCompose({ administration: false, examples: false });
const baseExample = resolveCompose({ administration: false, examples: true });
const administrationDefaults = resolveCompose({
  administration: true,
  examples: false,
});
const administrationExample = resolveCompose({
  administration: true,
  examples: true,
});

for (const configuration of [
  baseDefaults,
  baseExample,
  administrationDefaults,
  administrationExample,
]) {
  assertCatalogEnvironment(gatewayService(configuration).environment);
}

const baseService = gatewayService(baseDefaults);
requireContract(
  baseService.environment.TRINITY_PUSH_GATEWAY_ADMIN_ENABLED === undefined,
  'The base Compose deployment must remain administration-disabled.',
);
requireContract(
  baseService.read_only === true &&
    baseService.cap_drop?.includes('ALL') === true &&
    baseService.security_opt?.includes('no-new-privileges:true') === true &&
    baseService.user === '1000:1000' &&
    baseService.volumes?.some((volume) => volume.target === '/data') === true,
  'The resolved base deployment must retain its read-only non-root hardening.',
);
const basePort = baseService.ports?.[0];
requireContract(
  basePort?.host_ip === '127.0.0.1' &&
    basePort.published === catalogDefault('TRINITY_PUSH_GATEWAY_HOST_PORT') &&
    String(basePort.target) === catalogDefault('TRINITY_PUSH_GATEWAY_PORT'),
  'The resolved base deployment must retain catalog-owned loopback ports.',
);
requireContract(
  baseService.image ===
    `ghcr.io/quwisky/trinity-push-gateway:${catalogDefault(
      'TRINITY_PUSH_GATEWAY_VERSION',
    )}`,
  'The resolved base deployment must use the catalog-owned image default.',
);

const baseRuntime = loadResolvedBunConfiguration(baseService.environment);
requireContract(
  baseRuntime.clientIpHeader ===
    catalogDefault('TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER') &&
    baseRuntime.port === Number(catalogDefault('TRINITY_PUSH_GATEWAY_PORT')) &&
    baseRuntime.trustedProxyCidrs.length === 0,
  'The base Compose defaults must load through the Bun configuration interface.',
);
requireContract(
  loadResolvedAdministration(baseService.environment).kind === 'disabled',
  'The base Compose deployment must keep administration disabled.',
);

const exampleService = gatewayService(baseExample);
const exampleRuntime = loadResolvedBunConfiguration(exampleService.environment);
requireContract(
  exampleService.image === 'ghcr.io/quwisky/trinity-push-gateway:v0.1.0' &&
    exampleRuntime.environment.TRINITY_PUSH_GATEWAY_ANDROID_APP_ID ===
      'ovh.qwky.trinity.android' &&
    exampleRuntime.environment.TRINITY_PUSH_GATEWAY_IOS_APP_ID ===
      'ovh.qwky.trinity.ios' &&
    exampleRuntime.clientIpHeader ===
      catalogDefault('TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER'),
  'The self-hosting example must resolve to the documented Bun configuration.',
);

for (const name of [
  'TRINITY_PUSH_GATEWAY_HOST_PORT',
  'TRINITY_PUSH_GATEWAY_VERSION',
]) {
  requireContract(
    PUSH_GATEWAY_CONFIGURATION_CATALOG.reference(name)?.runtimes.includes(
      'compose',
    ) === true,
    `Resolved Compose input ${name} is not catalog-owned.`,
  );
}

assertSecretFiles(
  baseExample,
  [
    ['fcm_client_email', 'secrets/fcm_client_email'],
    ['fcm_private_key', 'secrets/fcm_private_key'],
    ['fcm_project_id', 'secrets/fcm_project_id'],
    ['fingerprint_key', 'secrets/fingerprint_key'],
  ],
  'self-hosting example',
);

function assertAdministration(configuration, label) {
  const service = gatewayService(configuration);
  const state = loadResolvedAdministration(service.environment);
  requireContract(
    state.kind === 'enabled',
    `The ${label} administration deployment must load through the catalog.`,
  );
  requireContract(
    state.configuration.databasePath ===
      catalogDefault('TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH') &&
      state.configuration.backupDirectory ===
        catalogDefault('TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY') &&
      state.configuration.oidcGroupClaim ===
        catalogDefault('TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM') &&
      state.configuration.oidcScopes.join(' ') ===
        catalogDefault('TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES') &&
      state.configuration.oidcTokenEndpointAuthMethod ===
        catalogDefault(
          'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
        ),
    `The ${label} administration defaults must match the catalog.`,
  );
  const safe = JSON.stringify(state.safe);
  requireContract(
    !safe.includes('test-oidc-client-secret') && !safe.includes('ssssssss'),
    `The ${label} safe projection must not expose resolved secrets.`,
  );
}

assertAdministration(administrationDefaults, 'default');
assertAdministration(administrationExample, 'example');
assertSecretFiles(
  administrationExample,
  [
    ['admin_oidc_client_secret', 'secrets/admin_oidc_client_secret'],
    ['admin_session_secret', 'secrets/admin_session_secret'],
  ],
  'administration example',
);

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
