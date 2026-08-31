import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ADMIN_CONFIGURATION_ENVIRONMENT_NAMES,
  loadAdminConfiguration,
} from '../../../src/bun/admin/config';
import {
  ADMIN_CONFIGURATION_DEFAULTS,
  ADMIN_POLICY_DEFAULTS,
} from '../../../src/configuration-defaults';

const temporaryDirectories: string[] = [];

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

function secretFile(name: string, value: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-admin-config-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, name);
  writeFileSync(file, value);
  return file;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Bun administration configuration', () => {
  it('is disabled by default without reading secret files', () => {
    const readFile = (): never => {
      throw new Error('disabled configuration must not read a secret');
    };

    expect(
      loadAdminConfiguration(
        {
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE: '/does/not/exist',
          TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/does/not/exist',
        },
        { readFile },
      ),
    ).toEqual({ kind: 'disabled' });
    expect(
      loadAdminConfiguration(
        {
          TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'false',
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE: '/does/not/exist',
          TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/does/not/exist',
        },
        { readFile },
      ),
    ).toEqual({ kind: 'disabled' });
  });

  it('loads fixed defaults and exposes only the safe API projection', () => {
    const state = loadAdminConfiguration(enabledEnvironment());

    expect(state.kind).toBe('enabled');
    if (state.kind !== 'enabled') {
      return;
    }

    expect(state.configuration).toMatchObject({
      assetsPath: '/app/admin',
      backupDirectory: '/data/backups',
      backupLimitBytes: 1_073_741_824,
      backupLimitCount: 24,
      databasePath: '/data/admin.sqlite',
      migrationsPath: '/app/admin-migrations',
      oidcClientId: 'gateway-client',
      oidcClientSecret: {
        source: 'env',
        value: 'oidc-client-secret',
      },
      oidcGroupClaim: 'groups',
      oidcIssuer: 'https://identity.example/application/o/gateway/',
      oidcRequiredGroup: 'gateway-operators',
      oidcScopes: ['openid', 'profile', 'email', 'groups'],
      oidcTokenEndpointAuthMethod: 'client_secret_basic',
      policy: ADMIN_POLICY_DEFAULTS,
      publicOrigin: 'https://gateway.example',
      sessionSecret: { source: 'env', value: 's'.repeat(32) },
    });
    expect(state.configuration.policyFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(state.safe).toEqual({
      administration: {
        administrationDatabasePath: '/data/admin.sqlite',
        auditRetentionDays: 90,
        backupCooldownSeconds: 3_600,
        backupDeadlineSeconds: 120,
        backupDirectory: '/data/backups',
        backupLimitBytes: 1_073_741_824,
        backupLimitCount: 24,
        cleanupCooldownSeconds: 300,
        cleanupDeadlineSeconds: 30,
        firebaseValidationCooldownSeconds: 60,
        firebaseValidationDeadlineSeconds: 20,
        maxSessionsDeployment: 100,
        maxSessionsPerIdentity: 5,
        metricsRetentionDays: 30,
        oidcClientId: 'gateway-client',
        oidcGroupClaim: 'groups',
        oidcIssuer: 'https://identity.example/application/o/gateway/',
        oidcRequiredGroup: 'gateway-operators',
        oidcScopes: ['openid', 'profile', 'email', 'groups'],
        oidcTokenEndpointAuthMethod: 'client_secret_basic',
        publicOrigin: 'https://gateway.example',
        sessionAbsoluteSeconds: 28_800,
        sessionIdleSeconds: 1_800,
      },
      credentials: {
        oidcClientSecret: { configured: true, source: 'env' },
        sessionSecret: { configured: true, source: 'env' },
      },
    });

    const safeJson = JSON.stringify(state.safe);
    expect(safeJson).not.toContain('oidc-client-secret');
    expect(safeJson).not.toContain('ssssssss');
    expect(safeJson).not.toContain('/app/admin');
    expect(safeJson).not.toContain('/app/admin-migrations');
  });

  it('loads mutually exclusive file secrets and retains source metadata only', () => {
    const oidcClientSecretFile = secretFile(
      'oidc-client-secret',
      'file-oidc-client-secret\n',
    );
    const sessionSecretFile = secretFile(
      'session-secret',
      `${'f'.repeat(32)}\n`,
    );
    const state = loadAdminConfiguration(
      enabledEnvironment({
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: undefined,
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE:
          oidcClientSecretFile,
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: undefined,
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: sessionSecretFile,
      }),
    );

    expect(state.kind).toBe('enabled');
    if (state.kind !== 'enabled') {
      return;
    }
    expect(state.configuration.oidcClientSecret).toEqual({
      source: 'file',
      value: 'file-oidc-client-secret',
    });
    expect(state.configuration.sessionSecret).toEqual({
      source: 'file',
      value: 'f'.repeat(32),
    });
    expect(state.safe.credentials).toEqual({
      oidcClientSecret: { configured: true, source: 'file' },
      sessionSecret: { configured: true, source: 'file' },
    });
    expect(JSON.stringify(state.safe)).not.toContain(oidcClientSecretFile);
    expect(JSON.stringify(state.safe)).not.toContain(sessionSecretFile);
  });

  it.each([
    ['localhost', 'http://localhost:3000', 'http://localhost:3000/issuer'],
    ['IPv4 loopback', 'http://127.0.0.1:3000', 'http://127.0.0.1/issuer'],
    ['IPv6 loopback', 'http://[::1]:3000', 'http://[::1]/issuer'],
  ])('permits HTTP for %s development endpoints', (_label, origin, issuer) => {
    expect(
      loadAdminConfiguration(
        enabledEnvironment({
          TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: issuer,
          TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: origin,
        }),
      ).kind,
    ).toBe('enabled');
  });

  it('normalizes scope order for the fixed policy fingerprint', () => {
    const first = loadAdminConfiguration(
      enabledEnvironment({
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES:
          'openid profile email groups custom',
      }),
    );
    const reordered = loadAdminConfiguration(
      enabledEnvironment({
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES:
          'custom groups email profile openid',
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: 'changed-secret',
        TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 't'.repeat(32),
        TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH: '/different/assets',
        TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH: '/different/migrations',
      }),
    );
    const changedGroup = loadAdminConfiguration(
      enabledEnvironment({
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: 'administrators',
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES:
          'openid profile email groups custom',
      }),
    );

    expect(first.kind).toBe('enabled');
    expect(reordered.kind).toBe('enabled');
    expect(changedGroup.kind).toBe('enabled');
    if (
      first.kind !== 'enabled' ||
      reordered.kind !== 'enabled' ||
      changedGroup.kind !== 'enabled'
    ) {
      return;
    }
    expect(reordered.configuration.policyFingerprint).toBe(
      first.configuration.policyFingerprint,
    );
    expect(changedGroup.configuration.policyFingerprint).not.toBe(
      first.configuration.policyFingerprint,
    );
  });

  it.each([
    [
      'a non-boolean enable value',
      { TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'yes' },
    ],
    [
      'a missing public origin',
      { TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: undefined },
    ],
    [
      'a remote HTTP public origin',
      { TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: 'http://gateway.example' },
    ],
    [
      'a public-origin path',
      {
        TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN:
          'https://gateway.example/admin',
      },
    ],
    [
      'a public-origin query',
      {
        TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN:
          'https://gateway.example?mode=admin',
      },
    ],
    [
      'a remote HTTP issuer',
      {
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER:
          'http://identity.example/issuer',
      },
    ],
    [
      'a missing client ID',
      { TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: undefined },
    ],
    [
      'both OIDC secret forms',
      { TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE: '/secret' },
    ],
    [
      'a missing OIDC secret file',
      {
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: undefined,
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE: '/does/not/exist',
      },
    ],
    [
      'both session secret forms',
      { TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE: '/secret' },
    ],
    [
      'a short session secret',
      { TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: 'too-short' },
    ],
    [
      'duplicate scopes',
      { TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: 'openid groups groups' },
    ],
    [
      'offline access',
      { TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: 'openid offline_access' },
    ],
    [
      'scopes without openid',
      { TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: 'profile email groups' },
    ],
    [
      'an invalid group claim',
      { TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM: 'nested.groups' },
    ],
    [
      'a missing required group',
      { TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: undefined },
    ],
    [
      'an unsupported client authentication method',
      {
        TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD: 'none',
      },
    ],
    [
      'a relative asset path',
      { TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH: 'dist/admin' },
    ],
    [
      'a relative database path',
      { TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: 'data/admin.sqlite' },
    ],
    [
      'a relative migrations path',
      { TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH: 'admin-migrations' },
    ],
    [
      'a relative backup path',
      { TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY: 'data/backups' },
    ],
    [
      'a zero backup count',
      { TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT: '0' },
    ],
    [
      'too many backups',
      { TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT: '1001' },
    ],
    [
      'a non-integer backup limit',
      { TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_BYTES: '1.5' },
    ],
  ])('returns invalid rather than throwing for %s', (_label, overrides) => {
    expect(loadAdminConfiguration(enabledEnvironment(overrides))).toEqual({
      kind: 'invalid',
    });
  });

  it('publishes every accepted administration environment name exactly once', () => {
    expect(new Set(ADMIN_CONFIGURATION_ENVIRONMENT_NAMES).size).toBe(
      ADMIN_CONFIGURATION_ENVIRONMENT_NAMES.length,
    );
    expect(ADMIN_CONFIGURATION_ENVIRONMENT_NAMES).toContain(
      'TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH',
    );
    expect(ADMIN_CONFIGURATION_ENVIRONMENT_NAMES).toContain(
      'TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH',
    );
    expect(ADMIN_CONFIGURATION_DEFAULTS).toMatchObject({
      TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH: '/app/admin',
      TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'false',
      TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH: '/app/admin-migrations',
      TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: 'openid profile email groups',
    });
  });
});
