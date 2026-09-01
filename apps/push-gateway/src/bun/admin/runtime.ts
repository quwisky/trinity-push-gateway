import type { BunConfiguration } from '../config';
import { createFirebaseValidator } from '../../fcm';
import type { GatewayMetricsSink } from '../../metrics';
import { readMigrations } from '../migrations';
import { createAdminSurface, type AdminSurface } from './app';
import { loadAdminAssets } from './assets';
import type { AdminConfigurationState } from './config';
import { assertAdministrationDatabaseSeparated } from './database-separation';
import { adminNotFoundResponse, adminUnavailableResponse } from './responses';
import { SqliteAdminStore } from './store';
import { createMetricsWriter, type MetricsWriter } from './metrics';
import { AdminOperations, createOperationBackend } from './operations';

type RuntimeEvent = Readonly<Record<string, unknown>>;

export type AdministrationRuntime = Readonly<{
  cleanup(nowSeconds: number): Promise<void>;
  close(): void;
  fetch(request: Request): Promise<Response>;
  kind: 'disabled' | 'ready' | 'unavailable';
  metrics: GatewayMetricsSink;
}>;

type CreateAdministrationRuntimeOptions = Readonly<{
  gatewayReady: () => boolean;
  log: (event: RuntimeEvent) => void;
  now?: () => number;
  operationEntryPath?: string;
}>;

const NOOP_METRICS: GatewayMetricsSink = Object.freeze({
  recordFcmAttempt: () => undefined,
  recordRequest: () => undefined,
});

export function isAdministrationRequest(request: Request): boolean {
  const pathname = new URL(request.url).pathname;
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function disabledRuntime(): AdministrationRuntime {
  return Object.freeze({
    cleanup: () => Promise.resolve(),
    close: () => undefined,
    fetch: () => Promise.resolve(adminNotFoundResponse()),
    kind: 'disabled' as const,
    metrics: NOOP_METRICS,
  });
}

function unavailableRuntime(): AdministrationRuntime {
  return Object.freeze({
    cleanup: () => Promise.resolve(),
    close: () => undefined,
    fetch: () => Promise.resolve(adminUnavailableResponse()),
    kind: 'unavailable' as const,
    metrics: NOOP_METRICS,
  });
}

function readyRuntime(
  surface: AdminSurface,
  metrics: MetricsWriter,
  log: (event: RuntimeEvent) => void,
): AdministrationRuntime {
  let available = true;
  return Object.freeze({
    async cleanup(nowSeconds): Promise<void> {
      if (!available) {
        return;
      }
      try {
        await surface.cleanup(nowSeconds);
      } catch {
        available = false;
        log({ event: 'admin_cleanup_failed', outcome: 'unavailable' });
        throw new Error('Administration cleanup failed.');
      }
    },
    close(): void {
      metrics.close();
      surface.close();
    },
    async fetch(request): Promise<Response> {
      if (!available) {
        return adminUnavailableResponse();
      }
      return surface.fetch(request);
    },
    kind: 'ready' as const,
    metrics,
  });
}

export async function createAdministrationRuntime(
  gatewayConfiguration: BunConfiguration,
  options: CreateAdministrationRuntimeOptions,
): Promise<AdministrationRuntime> {
  const state = gatewayConfiguration.administration;
  if (state.kind === 'disabled') {
    return disabledRuntime();
  }
  if (state.kind === 'invalid') {
    options.log({
      event: 'admin_configuration_invalid',
      outcome: 'unavailable',
    });
    return unavailableRuntime();
  }

  let store: SqliteAdminStore | undefined;
  let metrics: MetricsWriter | undefined;
  try {
    assertAdministrationDatabaseSeparated(
      gatewayConfiguration.databasePath,
      state.configuration.databasePath,
    );
    const migrations = readMigrations(state.configuration.migrationsPath);
    store = SqliteAdminStore.open(state.configuration.databasePath, migrations);
    if (!(await store.ready())) {
      throw new Error('Administration database is not ready.');
    }
    const assets = loadAdminAssets(state.configuration.assetsPath);
    try {
      metrics = createMetricsWriter(
        state.configuration.databasePath,
        options.log,
      );
    } catch {
      options.log({ event: 'admin_metrics_unavailable', outcome: 'dropped' });
      metrics = Object.freeze({ ...NOOP_METRICS, close: () => undefined });
    }
    const now = options.now ?? Date.now;
    const validator = createFirebaseValidator({
      clientEmail:
        gatewayConfiguration.environment.TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL,
      fetch,
      now,
      privateKey:
        gatewayConfiguration.environment.TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY,
      projectId:
        gatewayConfiguration.environment.TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID,
      timeoutMs:
        state.configuration.policy.firebaseValidationDeadlineSeconds * 1_000,
    });
    const operations = new AdminOperations(
      store,
      state.configuration,
      createOperationBackend(
        options.operationEntryPath ??
          new URL('../main.js', import.meta.url).pathname,
        validator,
      ),
      gatewayConfiguration.databasePath,
      now,
    );
    const surface = createAdminSurface({
      assets,
      configuration: state.configuration,
      gatewayConfiguration,
      gatewayReady: options.gatewayReady,
      log: options.log,
      operations,
      ...(options.now === undefined ? {} : { now: options.now }),
      safeConfiguration: state.safe,
      store,
    });
    await surface.cleanup(Math.floor((options.now?.() ?? Date.now()) / 1_000));
    options.log({ event: 'admin_started' });
    return readyRuntime(surface, metrics, options.log);
  } catch {
    metrics?.close();
    store?.close();
    options.log({
      event: 'admin_initialization_failed',
      outcome: 'unavailable',
    });
    return unavailableRuntime();
  }
}

function openAdminStoreForCommand(
  state: AdminConfigurationState,
  gatewayDatabasePath: string,
): SqliteAdminStore {
  if (state.kind !== 'enabled') {
    throw new Error('Administration must be enabled with valid configuration.');
  }
  assertAdministrationDatabaseSeparated(
    gatewayDatabasePath,
    state.configuration.databasePath,
  );
  return SqliteAdminStore.open(
    state.configuration.databasePath,
    readMigrations(state.configuration.migrationsPath),
  );
}

export function migrateAdministration(
  state: AdminConfigurationState,
  gatewayDatabasePath: string,
): void {
  const store = openAdminStoreForCommand(state, gatewayDatabasePath);
  store.close();
}

export async function purgeAdministrationSessions(
  state: AdminConfigurationState,
  nowSeconds: number,
  gatewayDatabasePath: string,
): Promise<number> {
  const store = openAdminStoreForCommand(state, gatewayDatabasePath);
  try {
    return await store.purgeSessions(nowSeconds);
  } finally {
    store.close();
  }
}
