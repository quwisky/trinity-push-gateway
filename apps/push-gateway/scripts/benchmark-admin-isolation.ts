import { Database } from 'bun:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AdminOperations } from '../src/bun/admin/operations';
import { loadBunConfiguration } from '../src/bun/config';
import { readMigrations } from '../src/bun/migrations';
import { startBunGateway, type RunningBunGateway } from '../src/bun/server';
import { SqliteGatewayStore } from '../src/bun/sqlite-store';
import { SqliteAdminStore } from '../src/bun/admin/store';

const GATEWAY_ROOT = path.join(import.meta.dir, '..');
const DELIVERY_MIGRATIONS = readMigrations(
  path.join(GATEWAY_ROOT, 'migrations'),
);
const ADMIN_MIGRATIONS = readMigrations(
  path.join(GATEWAY_ROOT, 'admin-migrations'),
);
const ROUNDS = 5;
const WARMUP_REQUESTS = 300;
const SAMPLE_REQUESTS = 2_000;
const CONCURRENCY = 16;
const SUSTAINED_REGRESSION_PERCENT = 5;
const directories: string[] = [];
const runtimes: RunningBunGateway[] = [];

type Harness = Readonly<{
  adminDatabasePath: string;
  configuration: ReturnType<typeof loadBunConfiguration>;
  deliveryCalls(): number;
  directory: string;
  logs: readonly Readonly<Record<string, unknown>>[];
  origin: string;
  runtime: RunningBunGateway;
}>;

type Measurement = Readonly<{
  errors: number;
  p95Ms: number;
}>;

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), `trinity-admin-benchmark-${label}-`),
  );
  directories.push(directory);
  return directory;
}

function createAssets(directory: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'index.html'),
    '<!doctype html><html lang="en"><head><base href="/admin/"><link rel="stylesheet" href="styles-ABCDEFGH.css"></head><body><tpg-root ngCspNonce="__TRINITY_ADMIN_CSP_NONCE__"></tpg-root><script nonce="__TRINITY_ADMIN_CSP_NONCE__" src="main-ABCDEFGH.js"></script></body></html>',
  );
  writeFileSync(path.join(directory, 'main-ABCDEFGH.js'), 'export {};');
  writeFileSync(path.join(directory, 'styles-ABCDEFGH.css'), 'body{}');
}

async function startHarness(enabled: boolean, label: string): Promise<Harness> {
  const directory = temporaryDirectory(label);
  const adminDatabasePath = path.join(directory, 'admin.sqlite');
  if (enabled) createAssets(path.join(directory, 'assets'));
  const environment = {
    ...(enabled
      ? {
          TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH: path.join(
            directory,
            'assets',
          ),
          TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY: path.join(
            directory,
            'backups',
          ),
          TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: adminDatabasePath,
          TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
          TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH: path.join(
            GATEWAY_ROOT,
            'admin-migrations',
          ),
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: 'benchmark-client',
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET:
            'benchmark-client-secret',
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: 'http://127.0.0.1:9',
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: 'gateway-operators',
          TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: 'http://127.0.0.1',
          TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 's'.repeat(32),
        }
      : {}),
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
    TRINITY_PUSH_GATEWAY_DATABASE_PATH: path.join(directory, 'gateway.sqlite'),
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'private-key',
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'example-project',
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'f'.repeat(32),
    TRINITY_PUSH_GATEWAY_HOST: '127.0.0.1',
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
    TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: '100000',
    TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT: '100000',
  } as const;
  const configuration = loadBunConfiguration(environment);
  const logs: Readonly<Record<string, unknown>>[] = [];
  let deliveryCalls = 0;
  const runtime = await startBunGateway(
    { ...configuration, port: 0 },
    DELIVERY_MIGRATIONS,
    {
      fcmClient: {
        send() {
          deliveryCalls += 1;
          return Promise.resolve({ kind: 'delivered' });
        },
      },
      installSignalHandlers: false,
      log: (event) => logs.push(event),
    },
  );
  runtimes.push(runtime);
  const origin = `http://127.0.0.1:${String(runtime.port)}`;
  if (enabled) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await fetch(`${origin}/admin/`)).status === 200) break;
      await Bun.sleep(5);
    }
    if ((await fetch(`${origin}/admin/`)).status !== 200) {
      throw new Error('Enabled administration did not become ready.');
    }
  }
  return {
    adminDatabasePath,
    configuration,
    deliveryCalls: () => deliveryCalls,
    directory,
    logs,
    origin,
    runtime,
  };
}

function notificationBody(index: number): string {
  return JSON.stringify({
    notification: {
      devices: [
        {
          app_id: 'example.android',
          data: {
            format: 'event_id_only',
            trinity_account_id: `benchmark-account-${String(index)}`,
            trinity_push_version: '1',
          },
          pushkey: `benchmark-registration-${String(index)}`,
        },
      ],
      event_id: `$benchmark-${String(index)}:example.test`,
      room_id: '!benchmark:example.test',
    },
  });
}

async function sendNotification(
  origin: string,
  index: number,
): Promise<Readonly<{ elapsedMs: number; error: boolean }>> {
  const started = performance.now();
  try {
    const response = await fetch(`${origin}/_matrix/push/v1/notify`, {
      body: notificationBody(index),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const body: unknown = await response.json();
    const valid =
      response.status === 200 &&
      typeof body === 'object' &&
      body !== null &&
      Array.isArray((body as { readonly rejected?: unknown }).rejected) &&
      (body as { readonly rejected: readonly unknown[] }).rejected.length === 0;
    return { elapsedMs: performance.now() - started, error: !valid };
  } catch {
    return { elapsedMs: performance.now() - started, error: true };
  }
}

async function measure(
  harness: Harness,
  count: number,
  indexOffset: number,
): Promise<Measurement> {
  let next = 0;
  const results: Readonly<{ elapsedMs: number; error: boolean }>[] = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= count) return;
        results[index] = await sendNotification(
          harness.origin,
          indexOffset + index,
        );
      }
    }),
  );
  const latencies = results
    .map(({ elapsedMs }) => elapsedMs)
    .sort((a, b) => a - b);
  const p95Index = Math.max(0, Math.ceil(latencies.length * 0.95) - 1);
  return {
    errors: results.filter(({ error }) => error).length,
    p95Ms: latencies[p95Index] ?? Number.POSITIVE_INFINITY,
  };
}

async function measureMode(
  enabled: boolean,
  round: number,
): Promise<Measurement> {
  const harness = await startHarness(
    enabled,
    `${enabled ? 'enabled' : 'disabled'}-${String(round)}`,
  );
  try {
    // Measure steady state after runtime and optional metrics-worker startup.
    await Bun.sleep(250);
    await measure(harness, WARMUP_REQUESTS, round * 100_000);
    const before = harness.deliveryCalls();
    const result = await measure(
      harness,
      SAMPLE_REQUESTS,
      round * 100_000 + WARMUP_REQUESTS,
    );
    if (result.errors !== 0) {
      throw new Error('A measured notification request failed.');
    }
    if (harness.deliveryCalls() - before !== SAMPLE_REQUESTS) {
      throw new Error(
        'FCM stub call count diverged from successful notifications.',
      );
    }
    return result;
  } finally {
    await harness.runtime.stop();
    runtimes.splice(runtimes.indexOf(harness.runtime), 1);
  }
}

async function exerciseFailureAndOperations(): Promise<
  Readonly<{
    errors: number;
    metricsFailureObserved: boolean;
    operations: readonly string[];
  }>
> {
  const harness = await startHarness(true, 'failure-and-operations');
  const administration = harness.configuration.administration;
  if (administration.kind !== 'enabled') {
    throw new Error('Expected enabled benchmark configuration.');
  }
  const store = SqliteAdminStore.open(
    harness.adminDatabasePath,
    ADMIN_MIGRATIONS,
  );
  const actor = {
    issuer: 'https://benchmark-issuer.example',
    subject: 'benchmark-operator',
  };
  await store.establishSession(actor, {
    id: 'benchmark-operation-session',
    nowSeconds: Math.floor(Date.now() / 1_000),
    policyFingerprint: administration.configuration.policyFingerprint,
    sessionDigest: 'benchmark-session-digest',
    xsrfDigest: 'benchmark-xsrf-digest',
  });
  const operations = new AdminOperations(
    store,
    administration.configuration,
    {
      backup(targetPath) {
        const gateway = SqliteGatewayStore.open(
          harness.configuration.databasePath,
          DELIVERY_MIGRATIONS,
        );
        try {
          gateway.backup(targetPath);
          return Promise.resolve('verified');
        } finally {
          gateway.close();
        }
      },
      cleanup() {
        const gateway = SqliteGatewayStore.open(
          harness.configuration.databasePath,
          DELIVERY_MIGRATIONS,
        );
        try {
          return gateway
            .cleanup(
              Math.floor(Date.now() / 1_000),
              new Date().toISOString().slice(0, 10),
            )
            .then(() => true);
        } finally {
          gateway.close();
        }
      },
      validateFirebase: () => Promise.resolve({ kind: 'succeeded' }),
    },
    harness.configuration.databasePath,
    Date.now,
  );

  try {
    const load = measure(harness, 1_000, 900_000);
    const backup = await operations.backup(actor);
    const cleanup = await operations.cleanup(actor);
    const loaded = await load;
    const completedOperations = [
      backup.kind === 'backup' ? 'backup' : `backup:${backup.kind}`,
      cleanup.kind === 'completed' && cleanup.result.outcome === 'succeeded'
        ? 'cleanup'
        : `cleanup:${cleanup.kind}`,
    ];

    const database = new Database(harness.adminDatabasePath);
    database.run('DROP TABLE request_metrics_hourly');
    database.close(true);
    const afterFailure = await measure(harness, 300, 950_000);
    for (let attempt = 0; attempt < 700; attempt += 1) {
      if (
        harness.logs.some(
          (event) =>
            event.event === 'admin_metrics_unavailable' &&
            event.outcome === 'dropped',
        )
      ) {
        break;
      }
      await Bun.sleep(10);
    }
    return {
      errors: loaded.errors + afterFailure.errors,
      metricsFailureObserved: harness.logs.some(
        (event) =>
          event.event === 'admin_metrics_unavailable' &&
          event.outcome === 'dropped',
      ),
      operations: completedOperations,
    };
  } finally {
    store.close();
    await harness.runtime.stop();
    runtimes.splice(runtimes.indexOf(harness.runtime), 1);
  }
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered[middle] ?? Number.POSITIVE_INFINITY;
}

try {
  const disabled: number[] = [];
  const enabled: number[] = [];
  let errors = 0;
  for (let round = 0; round < ROUNDS; round += 1) {
    const order = round % 2 === 0 ? [false, true] : [true, false];
    for (const mode of order) {
      const result = await measureMode(mode, round);
      errors += result.errors;
      (mode ? enabled : disabled).push(result.p95Ms);
    }
  }
  const disabledP95 = median(disabled);
  const enabledP95 = median(enabled);
  const deltaPercent = ((enabledP95 - disabledP95) / disabledP95) * 100;
  const regressedRounds = enabled.filter(
    (value, index) =>
      ((value - (disabled[index] ?? Number.POSITIVE_INFINITY)) /
        (disabled[index] ?? 1)) *
        100 >
      SUSTAINED_REGRESSION_PERCENT,
  ).length;
  const isolation = await exerciseFailureAndOperations();
  errors += isolation.errors;

  console.info('# Administration isolation benchmark');
  console.info('');
  console.info('| Evidence | Result |');
  console.info('| --- | ---: |');
  console.info(`| Disabled median p95 | ${disabledP95.toFixed(3)} ms |`);
  console.info(`| Enabled median p95 | ${enabledP95.toFixed(3)} ms |`);
  console.info(`| Median p95 delta | ${deltaPercent.toFixed(2)}% |`);
  console.info(
    `| Rounds above 5% | ${String(regressedRounds)} / ${String(ROUNDS)} |`,
  );
  console.info(`| Notification errors | ${String(errors)} |`);
  console.info(
    `| Metrics writer failure isolated | ${isolation.metricsFailureObserved ? 'yes' : 'no'} |`,
  );
  console.info(
    `| Operations under load | ${isolation.operations.join(', ')} |`,
  );
  for (let round = 0; round < ROUNDS; round += 1) {
    console.info(
      `| Round ${String(round + 1)} disabled / enabled | ${(disabled[round] ?? 0).toFixed(3)} / ${(enabled[round] ?? 0).toFixed(3)} ms |`,
    );
  }
  console.info('');
  console.info(
    `Bun ${Bun.version}; ${String(SAMPLE_REQUESTS)} measured requests per mode per round; concurrency ${String(CONCURRENCY)}.`,
  );

  if (errors !== 0) throw new Error('Notification errors are forbidden.');
  if (!isolation.metricsFailureObserved) {
    throw new Error('Metrics writer failure was not observed as isolated.');
  }
  if (!isolation.operations.every((operation) => !operation.includes(':'))) {
    throw new Error('An administration operation failed under Matrix load.');
  }
  if (
    deltaPercent > SUSTAINED_REGRESSION_PERCENT &&
    regressedRounds >= Math.ceil(ROUNDS * 0.6)
  ) {
    throw new Error('Sustained administration p95 regression exceeds 5%.');
  }
} finally {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop(true)));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
}
