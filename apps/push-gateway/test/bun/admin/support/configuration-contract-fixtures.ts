import type { AdminContractFixture as ConfigurationContractFixture } from './admin-contract-fixture';

export const MINIMAL_CONFIGURATION_RESPONSE = {
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
    enabled: true,
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
    firebaseClientEmail: { configured: true, source: 'file' },
    firebasePrivateKey: { configured: true, source: 'file' },
    firebaseProjectId: { configured: true, source: 'file' },
    fingerprintKey: { configured: true, source: 'file' },
    oidcClientSecret: { configured: true, source: 'file' },
    sessionSecret: { configured: true, source: 'file' },
  },
  gateway: {
    androidApplicationId: 'ovh.qwky.trinity.android',
    cleanupIntervalSeconds: 86_400,
    firebaseProjectId: 'trinity-production',
    gatewayDatabasePath: '/data/gateway.sqlite',
    iosApplicationId: 'ovh.qwky.trinity.ios',
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
  observedAt: '2026-08-31T18:00:00.000Z',
  version: '0.8.0-test',
} as const;

export const VALID_CONFIGURATION_FIXTURES: readonly ConfigurationContractFixture[] =
  [
    { name: 'file-backed credentials', value: MINIMAL_CONFIGURATION_RESPONSE },
    {
      name: 'direct credentials and post authentication',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        administration: {
          ...MINIMAL_CONFIGURATION_RESPONSE.administration,
          oidcTokenEndpointAuthMethod: 'client_secret_post',
        },
        credentials: Object.fromEntries(
          Object.keys(MINIMAL_CONFIGURATION_RESPONSE.credentials).map(
            (name) => [name, { configured: true, source: 'env' }],
          ),
        ),
      },
    },
  ];

export const INVALID_CONFIGURATION_FIXTURES: readonly ConfigurationContractFixture[] =
  [
    {
      name: 'non-UTC observation timestamp',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        observedAt: '2026-08-31T20:00:00+02:00',
      },
    },
    {
      name: 'relative gateway database path',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        gateway: {
          ...MINIMAL_CONFIGURATION_RESPONSE.gateway,
          gatewayDatabasePath: 'data/gateway.sqlite',
        },
      },
    },
    {
      name: 'invalid public origin',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        administration: {
          ...MINIMAL_CONFIGURATION_RESPONSE.administration,
          publicOrigin: 'not a URI',
        },
      },
    },
    {
      name: 'duplicate OIDC scope',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        administration: {
          ...MINIMAL_CONFIGURATION_RESPONSE.administration,
          oidcScopes: ['openid', 'openid'],
        },
      },
    },
    {
      name: 'changed fixed session policy',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        administration: {
          ...MINIMAL_CONFIGURATION_RESPONSE.administration,
          sessionIdleSeconds: 1_801,
        },
      },
    },
    {
      name: 'excessive installation count',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        gateway: {
          ...MINIMAL_CONFIGURATION_RESPONSE.gateway,
          maxClientInstallationsPerRequest: 50,
        },
      },
    },
    {
      name: 'invalid credential source',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        credentials: {
          ...MINIMAL_CONFIGURATION_RESPONSE.credentials,
          sessionSecret: { configured: true, source: 'vault' },
        },
      },
    },
    {
      name: 'unknown response property',
      value: {
        ...MINIMAL_CONFIGURATION_RESPONSE,
        rawEnvironment: 'must-not-leak',
      },
    },
  ];
