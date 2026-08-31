import { describe, expect, it } from 'vitest';

import {
  runtimeConfig,
  type ConfigurationEnvironment,
  type ConfigurationEnvironmentName,
} from '../src/config';

function validEnvironment(): ConfigurationEnvironment {
  return {
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'private-key',
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'example-project',
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'f'.repeat(32),
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
    TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES: '65536',
    TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: '20000',
    TRINITY_PUSH_GATEWAY_MAX_DEVICES: '49',
    TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS: '120',
    TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: '30',
    TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS: '86400',
    TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: '10',
  };
}

const numericEnvironmentNames = [
  'TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES',
  'TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS',
  'TRINITY_PUSH_GATEWAY_MAX_DEVICES',
  'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
  'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
  'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
  'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
] as const satisfies readonly ConfigurationEnvironmentName[];

describe('runtime configuration boundary', () => {
  it('returns only normalized numeric limits and tolerates unknown settings', () => {
    expect(
      runtimeConfig({
        ...validEnvironment(),
        FUTURE_GATEWAY_SETTING: { enabled: true },
      }),
    ).toEqual({
      maxBodyBytes: 65_536,
      maxDailyAttempts: 20_000,
      maxDevices: 49,
      pendingLeaseSeconds: 120,
      requestDeadlineSeconds: 30,
      terminalRetentionSeconds: 86_400,
      upstreamTimeoutSeconds: 10,
    });
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
      'fingerprint key has fewer than 32 UTF-8 bytes',
      { TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'f'.repeat(31) },
    ],
    [
      'Client Installation limit exceeds the Matrix request cap',
      { TRINITY_PUSH_GATEWAY_MAX_DEVICES: '50' },
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
  ] satisfies readonly [string, Partial<ConfigurationEnvironment>][])(
    'returns undefined when %s',
    (_description, overrides) => {
      expect(
        runtimeConfig({ ...validEnvironment(), ...overrides }),
      ).toBeUndefined();
    },
  );

  it.each(numericEnvironmentNames)(
    'returns undefined when %s exceeds the safe-integer range',
    (name) => {
      expect(
        runtimeConfig({
          ...validEnvironment(),
          [name]: '9007199254740992',
        }),
      ).toBeUndefined();
    },
  );

  it.each(['0', '-1', '1.5', '01', '+1', ' 1'])(
    'returns undefined for the non-canonical positive integer %j',
    (value) => {
      expect(
        runtimeConfig({
          ...validEnvironment(),
          TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES: value,
        }),
      ).toBeUndefined();
    },
  );

  it('accepts the maximum safe integer at an unconstrained numeric limit', () => {
    expect(
      runtimeConfig({
        ...validEnvironment(),
        TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES: '9007199254740991',
      }),
    ).toMatchObject({ maxBodyBytes: Number.MAX_SAFE_INTEGER });
  });
});
