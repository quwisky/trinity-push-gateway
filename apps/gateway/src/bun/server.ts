import type { Server } from 'bun';

import type { FcmClient } from '../fcm';
import {
  createRuntimeGateway,
  gatewayStorageUnavailableResponse,
  type GatewayRuntimeEnvironment,
} from '../gateway';
import { clientAddress } from './client-address';
import type { BunConfiguration } from './config';
import { createMemorySourceLimiter } from './source-limiter';
import { SqliteGatewayStore } from './sqlite-store';
import type { SqlMigration } from './sqlite-store';

type RuntimeEvent = Readonly<Record<string, unknown>>;

type StartOptions = {
  readonly fcmClient?: FcmClient;
  readonly installSignalHandlers?: boolean;
  readonly log?: (event: RuntimeEvent) => void;
  readonly now?: () => number;
  readonly shutdownGraceMs?: number;
  readonly terminate?: (exitCode: number) => void;
};

export type RunningBunGateway = {
  readonly port: number;
  readonly stop: (force?: boolean) => Promise<void>;
};

export async function startBunGateway(
  config: BunConfiguration,
  migrations: readonly SqlMigration[],
  options: StartOptions = {},
): Promise<RunningBunGateway> {
  const log =
    options.log ??
    ((event) => {
      console.info(JSON.stringify(event));
    });
  const now = options.now ?? Date.now;
  const store = SqliteGatewayStore.open(config.databasePath, migrations);
  const limiter = createMemorySourceLimiter({
    limit: config.sourceLimit,
    maxKeys: config.maxSourceKeys,
    now,
    periodSeconds: config.sourcePeriodSeconds,
  });
  const gateway = createRuntimeGateway({
    ...(options.fcmClient === undefined
      ? {}
      : { fcmClient: options.fcmClient }),
    log,
    now,
  });
  const directAddresses = new WeakMap<Request, string>();
  const drainWaiters = new Set<() => void>();
  const forcedShutdown = Promise.withResolvers<boolean>();
  let activeRequests = 0;
  let shuttingDown = false;
  const runtimeEnvironment: GatewayRuntimeEnvironment = {
    ...config.environment,
    limiter,
    sourceKey(request) {
      return clientAddress({
        clientIpHeader: config.clientIpHeader,
        directAddress: directAddresses.get(request),
        headers: request.headers,
        trustedProxyCidrs: config.trustedProxyCidrs,
      });
    },
    store,
  };

  try {
    await gateway.cleanup(runtimeEnvironment, now());
  } catch (error) {
    store.close();
    throw error;
  }

  const server: Server<undefined> = Bun.serve({
    async fetch(request, bunServer): Promise<Response> {
      if (shuttingDown) {
        return gatewayStorageUnavailableResponse();
      }
      activeRequests += 1;
      const directAddress = bunServer.requestIP(request)?.address;
      if (directAddress !== undefined) {
        directAddresses.set(request, directAddress);
      }
      try {
        return await gateway.fetch(request, runtimeEnvironment);
      } catch {
        log({ event: 'storage_failure', outcome: 'retryable' });
        return gatewayStorageUnavailableResponse();
      } finally {
        directAddresses.delete(request);
        activeRequests -= 1;
        if (activeRequests === 0) {
          for (const resolve of drainWaiters) {
            resolve();
          }
          drainWaiters.clear();
        }
      }
    },
    hostname: config.host,
    idleTimeout: 30,
    port: config.port,
  });

  const cleanupTimer = setInterval(() => {
    void gateway.cleanup(runtimeEnvironment, now()).catch(() => {
      log({ event: 'cleanup_failed', outcome: 'retryable' });
    });
  }, config.cleanupIntervalSeconds * 1000);
  cleanupTimer.unref();

  let stopped = false;
  let stopRequest: Promise<void> | undefined;
  const stop = async (force = false): Promise<void> => {
    if (stopped) {
      return;
    }
    if (stopRequest !== undefined) {
      if (force) {
        forcedShutdown.resolve(true);
      }
      return stopRequest;
    }
    stopRequest = (async () => {
      clearInterval(cleanupTimer);
      shuttingDown = true;
      let forceServerStop = force;
      if (!force && activeRequests > 0) {
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        const drained = new Promise<boolean>((resolve) => {
          drainWaiters.add(() => {
            resolve(true);
          });
        });
        const graceExpired = new Promise<boolean>((resolve) => {
          graceTimer = setTimeout(() => {
            resolve(false);
          }, options.shutdownGraceMs ?? 30_000);
        });
        const drainedCleanly = await Promise.race([
          drained,
          graceExpired,
          forcedShutdown.promise.then(() => false),
        ]);
        forceServerStop = !drainedCleanly;
        clearTimeout(graceTimer);
        drainWaiters.clear();
      }
      const serverStop = server.stop(true);
      if (!forceServerStop) {
        await serverStop;
      }
      store.close();
      stopped = true;
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      log({ event: 'gateway_stopped' });
      if (forceServerStop) {
        (options.terminate ?? process.exit)(0);
      }
    })();
    return stopRequest;
  };
  let signalCount = 0;
  const handleSignal = (): void => {
    signalCount += 1;
    void stop(signalCount > 1);
  };
  if (options.installSignalHandlers !== false) {
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
  }

  const port = server.port;
  if (port === undefined) {
    await stop(true);
    throw new Error('Bun did not report its listening port.');
  }
  log({ event: 'gateway_started', port });
  return { port, stop };
}
