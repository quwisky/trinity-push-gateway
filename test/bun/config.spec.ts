import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadBunConfiguration } from '../../src/bun/config';

const directories: string[] = [];

function requiredEnvironment(): Record<string, string> {
  return {
    ANDROID_APP_ID: 'example.android',
    FCM_CLIENT_EMAIL: 'gateway@example.test',
    FCM_PRIVATE_KEY: 'private-key',
    FCM_PROJECT_ID: 'example-project',
    FINGERPRINT_KEY: 'f'.repeat(32),
    IOS_APP_ID: 'example.ios',
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Bun runtime configuration', () => {
  it('uses bounded self-hosting defaults and requires explicit app ownership', () => {
    const config = loadBunConfiguration(requiredEnvironment());

    expect(config).toMatchObject({
      cleanupIntervalSeconds: 86_400,
      clientIpHeader: 'x-forwarded-for',
      databasePath: '/data/gateway.sqlite',
      host: '0.0.0.0',
      maxSourceKeys: 10_000,
      port: 3000,
      sourceLimit: 300,
      sourcePeriodSeconds: 10,
      trustedProxyCidrs: [],
    });
    expect(config.environment).toMatchObject({
      ANDROID_APP_ID: 'example.android',
      IOS_APP_ID: 'example.ios',
      MAX_BODY_BYTES: '65536',
      MAX_DAILY_ATTEMPTS: '20000',
      MAX_DEVICES: '49',
      PENDING_LEASE_SECONDS: '120',
      REQUEST_DEADLINE_SECONDS: '30',
      TERMINAL_RETENTION_SECONDS: '86400',
      UPSTREAM_TIMEOUT_SECONDS: '10',
    });
  });

  it('loads credentials from files without silently preferring one source', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'trinity-config-'));
    directories.push(directory);
    const privateKeyPath = path.join(directory, 'private-key');
    writeFileSync(privateKeyPath, 'file-private-key\n');
    const environment = requiredEnvironment();
    delete environment.FCM_PRIVATE_KEY;
    environment.FCM_PRIVATE_KEY_FILE = privateKeyPath;

    expect(loadBunConfiguration(environment).environment.FCM_PRIVATE_KEY).toBe(
      'file-private-key',
    );

    environment.FCM_PRIVATE_KEY = 'direct-private-key';
    expect(() => loadBunConfiguration(environment)).toThrow(
      'FCM_PRIVATE_KEY and FCM_PRIVATE_KEY_FILE cannot both be set',
    );
  });

  it('rejects invalid proxy, port, and secret configuration', () => {
    expect(() => loadBunConfiguration({})).toThrow('ANDROID_APP_ID');
    expect(() =>
      loadBunConfiguration({
        ...requiredEnvironment(),
        CLIENT_IP_HEADER: 'forwarded',
      }),
    ).toThrow('CLIENT_IP_HEADER');
    expect(() =>
      loadBunConfiguration({ ...requiredEnvironment(), PORT: '70000' }),
    ).toThrow('PORT');
  });
});
