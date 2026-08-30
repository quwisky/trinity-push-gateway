import type { Server } from 'bun';

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
  readonly installSignalHandlers?: boolean;
  readonly log?: (event: RuntimeEvent) => void;
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
  const store = SqliteGatewayStore.open(config.databasePath, migrations);
  const limiter = createMemorySourceLimiter({
    limit: config.sourceLimit,
    maxKeys: config.maxSourceKeys,
    now: Date.now,
    periodSeconds: config.sourcePeriodSeconds,
  });
  const gateway = createRuntimeGateway({ log, now: Date.now });
  const directAddresses = new WeakMap<Request, string>();
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
    await gateway.cleanup(runtimeEnvironment, Date.now());
  } catch (error) {
    store.close();
    throw error;
  }

  const server: Server<undefined> = Bun.serve({
    async fetch(request, bunServer): Promise<Response> {
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
      }
    },
    hostname: config.host,
    idleTimeout: 30,
    port: config.port,
  });

  const cleanupTimer = setInterval(() => {
    void gateway.cleanup(runtimeEnvironment, Date.now()).catch(() => {
      log({ event: 'cleanup_failed', outcome: 'retryable' });
    });
  }, config.cleanupIntervalSeconds * 1000);
  cleanupTimer.unref();

  let stopped = false;
  let stopping = false;
  const stop = async (force = false): Promise<void> => {
    if (stopped) {
      return;
    }
    if (stopping) {
      if (force) {
        await server.stop(true);
      }
      return;
    }
    stopping = true;
    clearInterval(cleanupTimer);
    await server.stop(force);
    store.close();
    stopped = true;
    process.off('SIGINT', handleSignal);
    process.off('SIGTERM', handleSignal);
    log({ event: 'gateway_stopped' });
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
