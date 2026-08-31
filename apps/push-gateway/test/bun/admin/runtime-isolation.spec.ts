import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadBunConfiguration } from '../../../src/bun/config';
import {
  startBunGateway,
  type RunningBunGateway,
} from '../../../src/bun/server';
import { SqliteGatewayStore } from '../../../src/bun/sqlite-store';
import { canonicalMigrations } from '../support';

const ADMIN_MIGRATIONS_PATH = path.join(
  import.meta.dir,
  '../../../admin-migrations',
);
const directories: string[] = [];
const providerServers: Server<undefined>[] = [];
const runtimes: RunningBunGateway[] = [];

type RuntimeHarness = Readonly<{
  adminKind: 'disabled' | 'enabled' | 'invalid';
  fcmCalls(): number;
  logs: readonly Readonly<Record<string, unknown>>[];
  origin: string;
}>;

function temporaryDirectory(): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'trinity-admin-runtime-isolation-'),
  );
  directories.push(directory);
  return directory;
}

function createValidAssets(directory: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'index.html'),
    `<!doctype html>
<html lang="en"><head><base href="/admin/"><link rel="stylesheet" href="styles-ABCDEFGH.css"></head>
<body><tpg-root ngCspNonce="__TRINITY_ADMIN_CSP_NONCE__"></tpg-root><script nonce="__TRINITY_ADMIN_CSP_NONCE__" src="main-ABCDEFGH.js"></script></body></html>`,
  );
  writeFileSync(path.join(directory, 'main-ABCDEFGH.js'), 'export {};');
  writeFileSync(path.join(directory, 'styles-ABCDEFGH.css'), 'body{}');
}

function notificationBody(): string {
  return JSON.stringify({
    notification: {
      counts: { unread: 1 },
      devices: [
        {
          app_id: 'example.android',
          data: {
            format: 'event_id_only',
            trinity_account_id: 'account-route',
            trinity_push_version: '1',
          },
          pushkey: 'registration-token',
        },
      ],
      event_id: '$event:example.test',
      room_id: '!room:example.test',
    },
  });
}

function gatewayEnvironment(
  directory: string,
): Record<string, string | undefined> {
  return {
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
    TRINITY_PUSH_GATEWAY_DATABASE_PATH: path.join(directory, 'gateway.sqlite'),
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'private-key',
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'example-project',
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'f'.repeat(32),
    TRINITY_PUSH_GATEWAY_HOST: '127.0.0.1',
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
  };
}

function enabledAdminEnvironment(
  directory: string,
): Record<string, string | undefined> {
  return {
    TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH: path.join(directory, 'assets'),
    TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY: path.join(
      directory,
      'backups',
    ),
    TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: path.join(
      directory,
      'admin.sqlite',
    ),
    TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
    TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH: ADMIN_MIGRATIONS_PATH,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: 'gateway-client',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: 'oidc-client-secret',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: 'http://127.0.0.1:9',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: 'gateway-operators',
    TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: 'http://127.0.0.1',
    TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 's'.repeat(32),
  };
}

async function startRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<RuntimeHarness> {
  const configuration = loadBunConfiguration(environment);
  const logs: Readonly<Record<string, unknown>>[] = [];
  let fcmCalls = 0;
  const runtime = await startBunGateway(
    { ...configuration, port: 0 },
    canonicalMigrations,
    {
      fcmClient: {
        send() {
          fcmCalls += 1;
          return Promise.resolve({ kind: 'delivered' });
        },
      },
      installSignalHandlers: false,
      log: (event) => logs.push(event),
    },
  );
  runtimes.push(runtime);
  return {
    adminKind: configuration.administration.kind,
    fcmCalls: () => fcmCalls,
    logs,
    origin: `http://127.0.0.1:${runtime.port}`,
  };
}

function expectNoCors(response: Response): void {
  expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  expect(response.headers.get('access-control-allow-headers')).toBeNull();
  expect(response.headers.get('access-control-allow-methods')).toBeNull();
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

async function expectRuntimeEvent(
  harness: RuntimeHarness,
  expected: Readonly<Record<string, unknown>>,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      harness.logs.some((event) =>
        Object.entries(expected).every(([key, value]) => event[key] === value),
      )
    ) {
      expect(harness.logs).toContainEqual(expected);
      return;
    }
    await Bun.sleep(1);
  }
  expect(harness.logs).toContainEqual(expected);
}

async function expectDeliveryHealthy(harness: RuntimeHarness): Promise<void> {
  const health = await fetch(`${harness.origin}/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({ status: 'ok' });

  const notification = await fetch(`${harness.origin}/_matrix/push/v1/notify`, {
    body: notificationBody(),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  expect(notification.status).toBe(200);
  expect(await notification.json()).toEqual({ rejected: [] });
  expect(harness.fcmCalls()).toBe(1);
}

async function expectGatewayIsolated(harness: RuntimeHarness): Promise<void> {
  const administration = await fetch(`${harness.origin}/admin/overview`);
  expect(administration.status).toBe(503);
  expect(await administration.json()).toMatchObject({
    code: 'admin_unavailable',
  });
  expectNoCors(administration);
  await expectDeliveryHealthy(harness);
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
  await Promise.all(
    providerServers.splice(0).map((server) => server.stop(true)),
  );
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('administration runtime isolation', () => {
  it('keeps Matrix delivery and health available for enabled-invalid configuration', async () => {
    const directory = temporaryDirectory();
    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
    });

    expect(harness.adminKind).toBe('invalid');
    await expectRuntimeEvent(harness, {
      event: 'admin_configuration_invalid',
      outcome: 'unavailable',
    });
    await expectGatewayIsolated(harness);
  });

  it('keeps Matrix delivery and health available when administration bootstrap fails', async () => {
    const directory = temporaryDirectory();
    mkdirSync(path.join(directory, 'assets'));
    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      ...enabledAdminEnvironment(directory),
    });

    expect(harness.adminKind).toBe('enabled');
    await expectRuntimeEvent(harness, {
      event: 'admin_initialization_failed',
      outcome: 'unavailable',
    });
    await expectGatewayIsolated(harness);
  });

  it('isolates an administration database that cannot be opened', async () => {
    const directory = temporaryDirectory();
    const databasePath = path.join(directory, 'admin.sqlite');
    mkdirSync(databasePath);
    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      ...enabledAdminEnvironment(directory),
      TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: databasePath,
    });

    expect(harness.adminKind).toBe('enabled');
    await expectRuntimeEvent(harness, {
      event: 'admin_initialization_failed',
      outcome: 'unavailable',
    });
    await expectGatewayIsolated(harness);
  });

  it('isolates syntactically invalid administration migrations', async () => {
    const directory = temporaryDirectory();
    const migrationsPath = path.join(directory, 'invalid-migrations');
    mkdirSync(migrationsPath);
    writeFileSync(
      path.join(migrationsPath, '0001_invalid.sql'),
      'THIS IS NOT VALID SQLITE;',
    );
    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      ...enabledAdminEnvironment(directory),
      TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH: migrationsPath,
    });

    expect(harness.adminKind).toBe('enabled');
    await expectRuntimeEvent(harness, {
      event: 'admin_initialization_failed',
      outcome: 'unavailable',
    });
    await expectGatewayIsolated(harness);
  });

  it('keeps Matrix delivery and health available during OIDC discovery outage', async () => {
    const directory = temporaryDirectory();
    createValidAssets(path.join(directory, 'assets'));
    const unavailableProvider = Bun.serve({
      port: 0,
      fetch: () => new Response('provider unavailable', { status: 503 }),
    });
    providerServers.push(unavailableProvider);
    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      ...enabledAdminEnvironment(directory),
      TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: `http://127.0.0.1:${unavailableProvider.port}`,
    });

    expect(harness.adminKind).toBe('enabled');
    await expectRuntimeEvent(harness, { event: 'admin_started' });
    const login = await fetch(`${harness.origin}/admin/auth/login`, {
      redirect: 'manual',
    });
    expect(login.status).toBe(503);
    expect(await login.json()).toMatchObject({ code: 'admin_unavailable' });
    expectNoCors(login);
    const staticRoute = await fetch(`${harness.origin}/admin/overview`);
    expect(staticRoute.status).toBe(200);
    await expectDeliveryHealthy(harness);
  });

  it('fails the operator surface closed when admin and delivery paths collide', async () => {
    const directory = temporaryDirectory();
    const gatewayPath = path.join(directory, 'gateway.sqlite');
    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      ...enabledAdminEnvironment(directory),
      TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: gatewayPath,
      TRINITY_PUSH_GATEWAY_DATABASE_PATH: gatewayPath,
    });

    expect(harness.adminKind).toBe('invalid');
    await expectRuntimeEvent(harness, {
      event: 'admin_configuration_invalid',
      outcome: 'unavailable',
    });
    await expectGatewayIsolated(harness);
  });

  it('fails the operator surface closed when its database is a symlink to delivery storage', async () => {
    const directory = temporaryDirectory();
    const gatewayPath = path.join(directory, 'gateway.sqlite');
    const adminPath = path.join(directory, 'admin.sqlite');
    const initialized = SqliteGatewayStore.open(
      gatewayPath,
      canonicalMigrations,
    );
    initialized.close();
    symlinkSync(gatewayPath, adminPath);
    createValidAssets(path.join(directory, 'assets'));

    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      ...enabledAdminEnvironment(directory),
      TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: adminPath,
      TRINITY_PUSH_GATEWAY_DATABASE_PATH: gatewayPath,
    });

    expect(harness.adminKind).toBe('enabled');
    await expectRuntimeEvent(harness, {
      event: 'admin_initialization_failed',
      outcome: 'unavailable',
    });
    await expectGatewayIsolated(harness);
  });

  it('fails the operator surface closed when its database is a hardlink to delivery storage', async () => {
    const directory = temporaryDirectory();
    const gatewayPath = path.join(directory, 'gateway.sqlite');
    const adminPath = path.join(directory, 'admin.sqlite');
    const initialized = SqliteGatewayStore.open(
      gatewayPath,
      canonicalMigrations,
    );
    initialized.close();
    linkSync(gatewayPath, adminPath);
    createValidAssets(path.join(directory, 'assets'));

    const harness = await startRuntime({
      ...gatewayEnvironment(directory),
      ...enabledAdminEnvironment(directory),
      TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: adminPath,
      TRINITY_PUSH_GATEWAY_DATABASE_PATH: gatewayPath,
    });

    expect(harness.adminKind).toBe('enabled');
    await expectRuntimeEvent(harness, {
      event: 'admin_initialization_failed',
      outcome: 'unavailable',
    });
    await expectGatewayIsolated(harness);
  });
});
