import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadBunConfiguration } from '../../src/bun/config';

const directories: string[] = [];

function requiredEnvironment(): Record<string, string> {
  return {
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'private-key',
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'example-project',
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'f'.repeat(32),
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
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
      TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
      TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
      TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES: '65536',
      TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: '20000',
      TRINITY_PUSH_GATEWAY_MAX_DEVICES: '49',
      TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS: '120',
      TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: '30',
      TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS: '86400',
      TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: '10',
    });
    expect(config.safe).toEqual({
      credentials: {
        firebaseClientEmail: { configured: true, source: 'env' },
        firebasePrivateKey: { configured: true, source: 'env' },
        firebaseProjectId: { configured: true, source: 'env' },
        fingerprintKey: { configured: true, source: 'env' },
      },
      gateway: {
        androidApplicationId: 'example.android',
        cleanupIntervalSeconds: 86_400,
        firebaseProjectId: 'example-project',
        gatewayDatabasePath: '/data/gateway.sqlite',
        iosApplicationId: 'example.ios',
        maxBodyBytes: 65_536,
        maxClientInstallationsPerRequest: 49,
        maxDailyAttempts: 20_000,
        maxSourceKeys: 10_000,
        pendingLeaseSeconds: 120,
        requestDeadlineSeconds: 30,
        sourceRateLimit: 300,
        sourceRatePeriodSeconds: 10,
        terminalRetentionSeconds: 86_400,
        upstreamTimeoutSeconds: 10,
      },
    });
    const safe = JSON.stringify(config.safe);
    expect(safe).not.toContain('gateway@example.test');
    expect(safe).not.toContain('private-key');
    expect(safe).not.toContain('ffffffff');
  });

  it('loads credentials from files without silently preferring one source', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'trinity-config-'));
    directories.push(directory);
    const privateKeyPath = path.join(directory, 'private-key');
    writeFileSync(privateKeyPath, 'file-private-key\n');
    const environment = requiredEnvironment();
    delete environment.TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY;
    environment.TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE = privateKeyPath;

    expect(
      loadBunConfiguration(environment).environment
        .TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY,
    ).toBe('file-private-key');

    environment.TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY = 'direct-private-key';
    expect(() => loadBunConfiguration(environment)).toThrow(
      'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY and TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE cannot both be set',
    );

    delete environment.TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY;
    writeFileSync(privateKeyPath, '\n');
    expect(() => loadBunConfiguration(environment)).toThrow(
      'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE contains an empty value',
    );
    environment.TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE = '';
    expect(() => loadBunConfiguration(environment)).toThrow(
      'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE cannot be empty',
    );
  });

  it('rejects invalid proxy, port, and secret configuration', () => {
    expect(() => loadBunConfiguration({})).toThrow(
      'TRINITY_PUSH_GATEWAY_ANDROID_APP_ID',
    );
    expect(() =>
      loadBunConfiguration({
        ...requiredEnvironment(),
        TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER: 'forwarded',
      }),
    ).toThrow('TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER');
    expect(() =>
      loadBunConfiguration({
        ...requiredEnvironment(),
        TRINITY_PUSH_GATEWAY_PORT: '70000',
      }),
    ).toThrow('TRINITY_PUSH_GATEWAY_PORT');
  });

  it.each([
    [
      'application identifiers are equal',
      {
        TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'same.app',
        TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'same.app',
      },
    ],
    [
      'fingerprint key is too short',
      { TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'short-key' },
    ],
    [
      'terminal retention does not exceed the pending lease',
      {
        TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS: '120',
        TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS: '120',
      },
    ],
    [
      'upstream timeout is not shorter than the request deadline',
      {
        TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: '30',
        TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: '30',
      },
    ],
  ] satisfies readonly [string, Record<string, string>][])(
    'uses the generic runtime error when %s',
    (_description, overrides) => {
      expect(() =>
        loadBunConfiguration({ ...requiredEnvironment(), ...overrides }),
      ).toThrow(/^Gateway runtime configuration is invalid\.$/u);
    },
  );

  it('does not accept legacy unprefixed configuration names', () => {
    expect(() =>
      loadBunConfiguration({
        ANDROID_APP_ID: 'example.android',
        FCM_CLIENT_EMAIL: 'gateway@example.test',
        FCM_PRIVATE_KEY: 'private-key',
        FCM_PROJECT_ID: 'example-project',
        FINGERPRINT_KEY: 'f'.repeat(32),
        IOS_APP_ID: 'example.ios',
      }),
    ).toThrow('TRINITY_PUSH_GATEWAY_ANDROID_APP_ID');
  });
});
