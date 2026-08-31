import * as z from 'zod/mini';

import {
  ADMIN_CONTRACT_REGISTRY,
  POSITIVE_SAFE_INTEGER_SCHEMA,
  UTC_TIMESTAMP_SCHEMA,
} from './shared';

const pathSchema = (description: string): z.ZodMiniType<string> =>
  z
    .string()
    .check(z.minLength(2), z.maxLength(4096), z.regex(/^\//u))
    .register(ADMIN_CONTRACT_REGISTRY, { description });

const fixedPositiveInteger = (value: number): z.ZodMiniType<number> =>
  z.number().check(z.int(), z.gte(value), z.lte(value));

const CONFIGURATION_SOURCE_SCHEMA = z
  .enum(['env', 'file'])
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'ConfigurationSource' });

const SECRET_PRESENCE_SCHEMA = z
  .strictObject({
    configured: z.boolean().register(ADMIN_CONTRACT_REGISTRY, {
      description: 'Whether a non-empty value was accepted at startup.',
    }),
    source: CONFIGURATION_SOURCE_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Secret presence and source only; never a value, variable name, or path.',
    id: 'SecretPresence',
  });

const GATEWAY_CONFIGURATION_SCHEMA = z
  .strictObject({
    androidApplicationId: z.string().check(z.minLength(1), z.maxLength(255)),
    iosApplicationId: z.string().check(z.minLength(1), z.maxLength(255)),
    firebaseProjectId: z
      .string()
      .check(z.minLength(1), z.maxLength(255))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Effective non-secret Firebase project identifier.',
      }),
    gatewayDatabasePath: pathSchema(
      'Absolute delivery-critical SQLite location.',
    ),
    maxBodyBytes: POSITIVE_SAFE_INTEGER_SCHEMA,
    maxDailyAttempts: POSITIVE_SAFE_INTEGER_SCHEMA,
    maxClientInstallationsPerRequest: z
      .number()
      .check(z.int(), z.gte(1), z.lte(49)),
    pendingLeaseSeconds: POSITIVE_SAFE_INTEGER_SCHEMA,
    requestDeadlineSeconds: POSITIVE_SAFE_INTEGER_SCHEMA,
    terminalRetentionSeconds: POSITIVE_SAFE_INTEGER_SCHEMA,
    upstreamTimeoutSeconds: POSITIVE_SAFE_INTEGER_SCHEMA,
    sourceRateLimit: POSITIVE_SAFE_INTEGER_SCHEMA,
    sourceRatePeriodSeconds: POSITIVE_SAFE_INTEGER_SCHEMA,
    maxSourceKeys: POSITIVE_SAFE_INTEGER_SCHEMA,
    cleanupIntervalSeconds: POSITIVE_SAFE_INTEGER_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Effective non-secret gateway values. Listener addresses, migration paths, trusted-proxy networks, and raw environment names are excluded.',
    id: 'GatewayConfiguration',
  });

const OIDC_SCOPE_SCHEMA = z
  .string()
  .check(z.regex(/^[A-Za-z0-9._:-]{1,128}$/u));

const ADMINISTRATION_CONFIGURATION_SCHEMA = z
  .strictObject({
    enabled: z.literal(true).register(ADMIN_CONTRACT_REGISTRY, {
      description: 'The administration surface is enabled for this response.',
    }),
    publicOrigin: z.url().check(z.minLength(8), z.maxLength(2048)),
    oidcIssuer: z.url().check(z.minLength(1), z.maxLength(2048)),
    oidcClientId: z
      .string()
      .check(z.minLength(1), z.maxLength(512))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Effective non-secret confidential-client identifier.',
      }),
    oidcScopes: z
      .array(OIDC_SCOPE_SCHEMA)
      .check(
        z.minLength(1),
        z.maxLength(16),
        z.refine((values) => new Set(values).size === values.length),
      )
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Exact configured OIDC scopes.',
        uniqueItems: true,
      }),
    oidcGroupClaim: z
      .string()
      .check(z.regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description:
          'Top-level claim used for exact required-group membership.',
      }),
    oidcRequiredGroup: z
      .string()
      .check(z.minLength(1), z.maxLength(256))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Exact case-sensitive group value required at login.',
      }),
    oidcTokenEndpointAuthMethod: z.enum([
      'client_secret_post',
      'client_secret_basic',
    ]),
    administrationDatabasePath: pathSchema(
      'Absolute isolated administration SQLite location.',
    ),
    backupDirectory: pathSchema(
      'Absolute directory for generated verified gateway backups.',
    ),
    sessionIdleSeconds: fixedPositiveInteger(1_800),
    sessionAbsoluteSeconds: fixedPositiveInteger(28_800),
    maxSessionsPerIdentity: fixedPositiveInteger(5),
    maxSessionsDeployment: fixedPositiveInteger(100),
    metricsRetentionDays: fixedPositiveInteger(30),
    auditRetentionDays: fixedPositiveInteger(90),
    firebaseValidationDeadlineSeconds: fixedPositiveInteger(20),
    firebaseValidationCooldownSeconds: fixedPositiveInteger(60),
    cleanupDeadlineSeconds: fixedPositiveInteger(30),
    cleanupCooldownSeconds: fixedPositiveInteger(300),
    backupDeadlineSeconds: fixedPositiveInteger(120),
    backupCooldownSeconds: fixedPositiveInteger(3_600),
    backupLimitCount: z.number().check(z.int(), z.gte(1), z.lte(1_000)),
    backupLimitBytes: POSITIVE_SAFE_INTEGER_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Effective non-secret administration policy and storage locations. Credential paths and raw environment names are excluded.',
    id: 'AdministrationConfiguration',
  });

const CREDENTIAL_PRESENCE_SCHEMA = z
  .strictObject({
    firebaseClientEmail: SECRET_PRESENCE_SCHEMA,
    firebasePrivateKey: SECRET_PRESENCE_SCHEMA,
    firebaseProjectId: SECRET_PRESENCE_SCHEMA,
    fingerprintKey: SECRET_PRESENCE_SCHEMA,
    oidcClientSecret: SECRET_PRESENCE_SCHEMA,
    sessionSecret: SECRET_PRESENCE_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'CredentialPresence' });

export const CONFIGURATION_RESPONSE_SCHEMA = z
  .strictObject({
    observedAt: UTC_TIMESTAMP_SCHEMA,
    version: z
      .string()
      .check(z.minLength(1), z.maxLength(128))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Running Push Gateway release version.',
      }),
    gateway: GATEWAY_CONFIGURATION_SCHEMA,
    administration: ADMINISTRATION_CONFIGURATION_SCHEMA,
    credentials: CREDENTIAL_PRESENCE_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'Configuration' });

export type AdministrationConfigurationResponse = z.infer<
  typeof ADMINISTRATION_CONFIGURATION_SCHEMA
>;
export type ConfigurationResponse = z.infer<
  typeof CONFIGURATION_RESPONSE_SCHEMA
>;
export type GatewayConfigurationResponse = z.infer<
  typeof GATEWAY_CONFIGURATION_SCHEMA
>;
export type SecretPresenceResponse = z.infer<typeof SECRET_PRESENCE_SCHEMA>;
export type ConfiguredSecretPresenceResponse = Readonly<
  Omit<SecretPresenceResponse, 'configured'> & { configured: true }
>;
