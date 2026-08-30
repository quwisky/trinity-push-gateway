import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadBunConfiguration } from '../../src/bun/config';
import { startBunGateway } from '../../src/bun/server';
import { canonicalMigrations } from './support';

const directories: string[] = [];

function createTestConfig(): ReturnType<typeof loadBunConfiguration> {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-server-'));
  directories.push(directory);
  return loadBunConfiguration({
    ANDROID_APP_ID: 'example.android',
    DATABASE_PATH: path.join(directory, 'gateway.sqlite'),
    FCM_CLIENT_EMAIL: 'gateway@example.test',
    FCM_PRIVATE_KEY: 'private-key',
    FCM_PROJECT_ID: 'example-project',
    FINGERPRINT_KEY: 'f'.repeat(32),
    HOST: '127.0.0.1',
    IOS_APP_ID: 'example.ios',
  });
}

function notificationBody(pushKey: string, eventId: string): string {
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
          pushkey: pushKey,
        },
      ],
      event_id: eventId,
      room_id: '!room:example.test',
    },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Bun HTTP runtime', () => {
  it('migrates before listening and serves the shared health and Matrix contracts', async () => {
    const config = createTestConfig();
    const runtime = await startBunGateway(
      { ...config, port: 0 },
      canonicalMigrations,
      { installSignalHandlers: false, log: () => undefined },
    );

    const origin = `http://127.0.0.1:${runtime.port}`;
    const health = await fetch(`${origin}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });

    const notify = await fetch(`${origin}/_matrix/push/v1/notify`, {
      body: JSON.stringify({ notification: { devices: [] } }),
      method: 'POST',
    });
    expect(notify.status).toBe(200);
    expect(await notify.json()).toEqual({ rejected: [] });

    await runtime.stop();
  });

  it('finishes an in-flight notification before graceful shutdown', async () => {
    const config = createTestConfig();
    let releaseDelivery: (() => void) | undefined;
    const deliveryStarted = Promise.withResolvers<boolean>();
    const deliveryReleased = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    const runtime = await startBunGateway(
      { ...config, port: 0 },
      canonicalMigrations,
      {
        fcmClient: {
          async send() {
            deliveryStarted.resolve(true);
            await deliveryReleased;
            return { kind: 'delivered' };
          },
        },
        installSignalHandlers: false,
        log: () => undefined,
      },
    );
    const responsePromise = fetch(
      `http://127.0.0.1:${runtime.port}/_matrix/push/v1/notify`,
      {
        body: notificationBody('fcm-registration', '$event:example.test'),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );
    await deliveryStarted.promise;

    let stopped = false;
    const stopPromise = runtime.stop().then(() => {
      stopped = true;
    });
    await Bun.sleep(10);
    expect(stopped).toBe(false);
    releaseDelivery?.();

    expect((await responsePromise).status).toBe(200);
    await stopPromise;
    expect(stopped).toBe(true);
  });

  it('forces shutdown after the internal grace ceiling', async () => {
    const config = createTestConfig();
    const deliveryStarted = Promise.withResolvers<boolean>();
    let terminationCode: number | undefined;
    const runtime = await startBunGateway(
      { ...config, port: 0 },
      canonicalMigrations,
      {
        fcmClient: {
          async send() {
            deliveryStarted.resolve(true);
            await Bun.sleep(200);
            return { kind: 'delivered' };
          },
        },
        installSignalHandlers: false,
        log: () => undefined,
        shutdownGraceMs: 10,
        terminate(exitCode) {
          terminationCode = exitCode;
        },
      },
    );
    void fetch(`http://127.0.0.1:${runtime.port}/_matrix/push/v1/notify`, {
      body: notificationBody('hanging-registration', '$hanging:example.test'),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }).catch(() => undefined);
    await deliveryStarted.promise;

    const startedAt = performance.now();
    await runtime.stop();
    expect(performance.now() - startedAt).toBeLessThan(100);
    expect(terminationCode).toBe(0);
  });

  it('ends the graceful drain early when a second stop is forced', async () => {
    const config = createTestConfig();
    const deliveryStarted = Promise.withResolvers<boolean>();
    let terminationCode: number | undefined;
    const runtime = await startBunGateway(
      { ...config, port: 0 },
      canonicalMigrations,
      {
        fcmClient: {
          async send() {
            deliveryStarted.resolve(true);
            await Bun.sleep(200);
            return { kind: 'delivered' };
          },
        },
        installSignalHandlers: false,
        log: () => undefined,
        shutdownGraceMs: 1_000,
        terminate(exitCode) {
          terminationCode = exitCode;
        },
      },
    );
    void fetch(`http://127.0.0.1:${runtime.port}/_matrix/push/v1/notify`, {
      body: notificationBody('forced-registration', '$forced:example.test'),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }).catch(() => undefined);
    await deliveryStarted.promise;

    const startedAt = performance.now();
    const gracefulStop = runtime.stop();
    await Bun.sleep(10);
    await runtime.stop(true);
    await gracefulStop;
    expect(performance.now() - startedAt).toBeLessThan(100);
    expect(terminationCode).toBe(0);
  });

  it('serves concurrent SQLite-coordinated notifications without serial stalls', async () => {
    const config = createTestConfig();
    const runtime = await startBunGateway(
      { ...config, port: 0 },
      canonicalMigrations,
      {
        fcmClient: {
          async send() {
            return { kind: 'delivered' };
          },
        },
        installSignalHandlers: false,
        log: () => undefined,
      },
    );
    const startedAt = performance.now();
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        fetch(`http://127.0.0.1:${runtime.port}/_matrix/push/v1/notify`, {
          body: notificationBody(
            `registration-${index}`,
            `$event-${index}:example.test`,
          ),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      ),
    );
    const durationMs = performance.now() - startedAt;

    expect(responses.every(({ status }) => status === 200)).toBe(true);
    expect(durationMs).toBeLessThan(2_000);
    await runtime.stop();
  });
});
