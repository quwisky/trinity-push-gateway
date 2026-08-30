import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadBunConfiguration } from '../../src/bun/config';
import { startBunGateway } from '../../src/bun/server';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Bun HTTP runtime', () => {
  it('migrates before listening and serves the shared health and Matrix contracts', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'trinity-server-'));
    directories.push(directory);
    const config = loadBunConfiguration({
      ANDROID_APP_ID: 'example.android',
      DATABASE_PATH: path.join(directory, 'gateway.sqlite'),
      FCM_CLIENT_EMAIL: 'gateway@example.test',
      FCM_PRIVATE_KEY: 'private-key',
      FCM_PROJECT_ID: 'example-project',
      FINGERPRINT_KEY: 'f'.repeat(32),
      HOST: '127.0.0.1',
      IOS_APP_ID: 'example.ios',
    });
    const runtime = await startBunGateway(
      { ...config, port: 0 },
      [
        {
          name: '0001_initial.sql',
          sql: readFileSync(
            path.join(import.meta.dir, '../../migrations/0001_initial.sql'),
            'utf8',
          ),
        },
      ],
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
});
