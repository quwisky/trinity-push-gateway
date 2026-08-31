import { createHash } from 'node:crypto';

import { describe, expect, it } from 'bun:test';

import {
  GATEWAY_CONFIGURATION_REFERENCE,
  loadAdministrationConfiguration,
  PUSH_GATEWAY_CONFIGURATION_CATALOG,
  type GatewayConfigurationName,
} from '../../../src/configuration-catalog';

const expectedNames = [
  'TRINITY_PUSH_GATEWAY_ANDROID_APP_ID',
  'TRINITY_PUSH_GATEWAY_IOS_APP_ID',
  'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL',
  'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY',
  'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID',
  'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY',
  'TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES',
  'TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS',
  'TRINITY_PUSH_GATEWAY_MAX_DEVICES',
  'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
  'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
  'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
  'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
  'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL_FILE',
  'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE',
  'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID_FILE',
  'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY_FILE',
  'TRINITY_PUSH_GATEWAY_HOST',
  'TRINITY_PUSH_GATEWAY_PORT',
  'TRINITY_PUSH_GATEWAY_DATABASE_PATH',
  'TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH',
  'TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT',
  'TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS',
  'TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS',
  'TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS',
  'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER',
  'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS',
  'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
  'TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN',
  'TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH',
  'TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH',
  'TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH',
  'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY',
  'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT',
  'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_BYTES',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP',
  'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
  'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
  'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
  'TRINITY_PUSH_GATEWAY_HOST_PORT',
  'TRINITY_PUSH_GATEWAY_VERSION',
] as const satisfies readonly GatewayConfigurationName[];

function enabledEnvironment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: 'gateway-client',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: 'oidc-client-secret',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER:
      'https://identity.example/application/o/gateway/',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: 'gateway-operators',
    TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: 'https://gateway.example',
    TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 's'.repeat(32),
    ...overrides,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('authoritative Push Gateway configuration catalog', () => {
  it('owns every supported setting exactly once', () => {
    const names = GATEWAY_CONFIGURATION_REFERENCE.map(({ name }) => name);

    expect(names).toEqual([...expectedNames]);
    expect(new Set(names).size).toBe(expectedNames.length);
    for (const name of expectedNames) {
      expect(PUSH_GATEWAY_CONFIGURATION_CATALOG.reference(name).name).toBe(
        name,
      );
    }
  });

  it('does not read or project administration secrets while disabled', () => {
    let reads = 0;
    let hashes = 0;

    expect(
      loadAdministrationConfiguration(
        {
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE: '/does/not/exist',
          TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/does/not/exist',
        },
        {
          readFile: () => {
            reads += 1;
            throw new Error('disabled configuration must not read secrets');
          },
          sha256: () => {
            hashes += 1;
            return 'unused';
          },
        },
      ),
    ).toEqual({ kind: 'disabled' });
    expect({ hashes, reads }).toEqual({ hashes: 0, reads: 0 });
  });

  it('projects secret presence without values or file paths', () => {
    const state = loadAdministrationConfiguration(
      enabledEnvironment({
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: undefined,
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE: '/run/secrets/oidc',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: undefined,
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/run/secrets/session',
      }),
      {
        readFile: (path) =>
          path.endsWith('/oidc') ? 'file-oidc-secret\n' : `${'f'.repeat(32)}\n`,
        sha256,
      },
    );

    expect(state.kind).toBe('enabled');
    if (state.kind !== 'enabled') {
      return;
    }
    expect(state.safe.credentials).toEqual({
      oidcClientSecret: { configured: true, source: 'file' },
      sessionSecret: { configured: true, source: 'file' },
    });
    const safe = JSON.stringify(state.safe);
    expect(safe).not.toContain('file-oidc-secret');
    expect(safe).not.toContain('/run/secrets');
    expect(safe).not.toContain('ffffffff');
  });

  it('preserves the stable policy fingerprint for equivalent settings', () => {
    const baseline = loadAdministrationConfiguration(enabledEnvironment(), {
      readFile: () => 'unused',
      sha256,
    });
    const reordered = loadAdministrationConfiguration(
      enabledEnvironment({
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: 'groups email profile openid',
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: 'different-secret',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 't'.repeat(32),
      }),
      { readFile: () => 'unused', sha256 },
    );

    expect(baseline.kind).toBe('enabled');
    expect(reordered.kind).toBe('enabled');
    if (baseline.kind !== 'enabled' || reordered.kind !== 'enabled') {
      return;
    }
    expect(baseline.configuration.policyFingerprint).toBe(
      '9b8492dc6b1c7e13c28ddae0d79250ccdb42fe8b00999eefa1b0e402a5af4d8b',
    );
    expect(reordered.configuration.policyFingerprint).toBe(
      baseline.configuration.policyFingerprint,
    );
  });
});
