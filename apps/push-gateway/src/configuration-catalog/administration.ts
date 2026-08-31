import * as z from 'zod/mini';

import {
  catalogDefaults,
  resolveCatalogSecret,
  type CatalogSecret,
  type ConfigurationEnvironment,
} from './types';

const bunRuntime = ['bun'] as const;

export const ADMINISTRATION_CONFIGURATION_DEFINITIONS = Object.freeze([
  {
    constraint:
      'Exact true or false; every other administration value is ignored while false.',
    defaultValue: 'false',
    description: 'Opt in to the isolated Bun administration surface.',
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
    required: false,
    runtimes: bunRuntime,
    secret: false,
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN',
    description:
      'Exact same origin used by the Push Gateway UI and operator API.',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint:
      'Required when enabled; HTTPS without a path, query, or fragment, except loopback HTTP for development.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH',
    description: 'Internal directory containing production browser assets.',
    defaultValue: '/app/admin',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Absolute Bun-local path; excluded from the operator API.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH',
    description: 'Path to the isolated administration SQLite database.',
    defaultValue: '/data/admin.sqlite',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Absolute path distinct from the gateway database.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH',
    description:
      'Internal directory containing administration database migrations.',
    defaultValue: '/app/admin-migrations',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Absolute Bun-local path; excluded from the operator API.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY',
    description: 'Directory for verified gateway-database backups.',
    defaultValue: '/data/backups',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Absolute path on the persistent local volume.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT',
    description: 'Maximum verified backups retained in the backup directory.',
    defaultValue: '24',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Positive integer no greater than 1000.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_BYTES',
    description: 'Maximum aggregate bytes allowed for verified backups.',
    defaultValue: '1073741824',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Positive safe integer.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER',
    description: 'Exact issuer URL discovered for Operator authentication.',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint:
      'Required when enabled; HTTPS, except loopback HTTP for development.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID',
    description: 'Confidential OIDC client identifier.',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Required when enabled.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET',
    description: 'Confidential OIDC client secret.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint:
      'Required directly or by file when enabled; mutually exclusive with its file alternative.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET_FILE',
    description: 'Confidential OIDC client-secret file.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint:
      'Required directly or by file when enabled; mutually exclusive with its direct alternative.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES',
    description: 'Whitespace-separated OIDC scopes requested at login.',
    defaultValue: 'openid profile email groups',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Unique scopes including openid; offline_access is forbidden.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM',
    description: 'Top-level ID-token claim containing exact group values.',
    defaultValue: 'groups',
    required: false,
    runtimes: bunRuntime,
    secret: false,
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP',
    description: 'Exact case-sensitive group required for Operator access.',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Required when enabled.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD',
    description: 'Confidential-client token endpoint authentication method.',
    defaultValue: 'client_secret_basic',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'client_secret_basic or client_secret_post.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
    description: 'Independent secret used to protect Operator Sessions.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint:
      'At least 32 UTF-8 bytes and required directly or by file when enabled; mutually exclusive with its file alternative.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
    description: 'Operator Session secret file.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint:
      'Required directly or by file when enabled; mutually exclusive with its direct alternative.',
  },
] as const);

const ADMIN_CONFIGURATION_DEFAULTS = catalogDefaults(
  ADMINISTRATION_CONFIGURATION_DEFINITIONS,
);

const ADMIN_POLICY_DEFAULTS = Object.freeze({
  auditRetentionDays: 90,
  backupCooldownSeconds: 3_600,
  backupDeadlineSeconds: 120,
  cleanupCooldownSeconds: 300,
  cleanupDeadlineSeconds: 30,
  firebaseValidationCooldownSeconds: 60,
  firebaseValidationDeadlineSeconds: 20,
  maximumDeploymentSessions: 100,
  maximumSessionsPerIdentity: 5,
  metricsRetentionDays: 30,
  sessionAbsoluteSeconds: 28_800,
  sessionIdleSeconds: 1_800,
});

export type AdminSecret = CatalogSecret;
export type AdministrationPolicy = Readonly<typeof ADMIN_POLICY_DEFAULTS>;

export type AdminConfiguration = Readonly<{
  assetsPath: string;
  backupDirectory: string;
  backupLimitBytes: number;
  backupLimitCount: number;
  databasePath: string;
  migrationsPath: string;
  oidcClientId: string;
  oidcClientSecret: AdminSecret;
  oidcGroupClaim: string;
  oidcIssuer: string;
  oidcRequiredGroup: string;
  oidcScopes: readonly string[];
  oidcTokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
  policy: AdministrationPolicy;
  policyFingerprint: string;
  publicOrigin: string;
  sessionSecret: AdminSecret;
}>;

type SafeSecretPresence = Readonly<{
  configured: true;
  source: AdminSecret['source'];
}>;

export type SafeAdminConfiguration = Readonly<{
  administration: Readonly<{
    administrationDatabasePath: string;
    auditRetentionDays: number;
    backupCooldownSeconds: number;
    backupDeadlineSeconds: number;
    backupDirectory: string;
    backupLimitBytes: number;
    backupLimitCount: number;
    cleanupCooldownSeconds: number;
    cleanupDeadlineSeconds: number;
    enabled: true;
    firebaseValidationCooldownSeconds: number;
    firebaseValidationDeadlineSeconds: number;
    maxSessionsDeployment: number;
    maxSessionsPerIdentity: number;
    metricsRetentionDays: number;
    oidcClientId: string;
    oidcGroupClaim: string;
    oidcIssuer: string;
    oidcRequiredGroup: string;
    oidcScopes: readonly string[];
    oidcTokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post';
    publicOrigin: string;
    sessionAbsoluteSeconds: number;
    sessionIdleSeconds: number;
  }>;
  credentials: Readonly<{
    oidcClientSecret: SafeSecretPresence;
    sessionSecret: SafeSecretPresence;
  }>;
}>;

export type AdminConfigurationState =
  | Readonly<{ kind: 'disabled' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{
      configuration: AdminConfiguration;
      kind: 'enabled';
      safe: SafeAdminConfiguration;
    }>;

type LoadAdministrationConfigurationOptions = Readonly<{
  readFile: (path: string) => string;
  sha256: (value: string) => string;
}>;

const ENABLED_SCHEMA = z.enum(['true', 'false']);
const PATH_SCHEMA = z
  .string()
  .check(z.minLength(2), z.maxLength(4096), z.regex(/^\//u));
const CLIENT_ID_SCHEMA = z.string().check(z.minLength(1), z.maxLength(512));
const REQUIRED_GROUP_SCHEMA = z
  .string()
  .check(z.minLength(1), z.maxLength(256));
const GROUP_CLAIM_SCHEMA = z
  .string()
  .check(z.regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u));
const SCOPE_SCHEMA = z.string().check(z.regex(/^[A-Za-z0-9._:-]{1,128}$/u));

function parsed<T>(schema: z.ZodMiniType<T>, value: unknown): T | undefined {
  const result = z.safeParse(schema, value);
  return result.success ? result.data : undefined;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === 'localhost'
  );
}

function endpoint(
  raw: string | undefined,
  exactOrigin: boolean,
): string | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  try {
    const url = new URL(raw);
    if (
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== '' ||
      url.search !== '' ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && isLoopback(url.hostname))) ||
      (exactOrigin && raw !== url.origin)
    ) {
      return undefined;
    }
    return exactOrigin ? url.origin : url.href;
  } catch {
    return undefined;
  }
}

function integer(
  raw: string | undefined,
  fallback: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const value = Number(raw ?? fallback);
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum
    ? value
    : undefined;
}

function secret(
  environment: ConfigurationEnvironment,
  name:
    | 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET'
    | 'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
  readFile: (path: string) => string,
  minimumBytes = 1,
): AdminSecret | undefined {
  const resolution = resolveCatalogSecret(
    environment,
    name,
    readFile,
    minimumBytes,
  );
  return resolution.kind === 'resolved' ? resolution.secret : undefined;
}

function scopes(raw: string): readonly string[] | undefined {
  const values = raw.split(/\s+/u).filter((value) => value.length > 0);
  if (
    values.length === 0 ||
    values.length > 16 ||
    new Set(values).size !== values.length ||
    !values.includes('openid') ||
    values.includes('offline_access') ||
    values.some((value) => parsed(SCOPE_SCHEMA, value) === undefined)
  ) {
    return undefined;
  }
  return values;
}

function policyFingerprint(
  input: {
    readonly oidcClientId: string;
    readonly oidcGroupClaim: string;
    readonly oidcIssuer: string;
    readonly oidcRequiredGroup: string;
    readonly oidcScopes: readonly string[];
    readonly oidcTokenEndpointAuthMethod: string;
    readonly publicOrigin: string;
  },
  sha256: (value: string) => string,
): string {
  return sha256(
    JSON.stringify({
      ...input,
      oidcScopes: [...input.oidcScopes].sort(),
      policy: ADMIN_POLICY_DEFAULTS,
    }),
  );
}

function safeConfiguration(
  configuration: AdminConfiguration,
): SafeAdminConfiguration {
  const policy = configuration.policy;
  return {
    administration: {
      administrationDatabasePath: configuration.databasePath,
      auditRetentionDays: policy.auditRetentionDays,
      backupCooldownSeconds: policy.backupCooldownSeconds,
      backupDeadlineSeconds: policy.backupDeadlineSeconds,
      backupDirectory: configuration.backupDirectory,
      backupLimitBytes: configuration.backupLimitBytes,
      backupLimitCount: configuration.backupLimitCount,
      cleanupCooldownSeconds: policy.cleanupCooldownSeconds,
      cleanupDeadlineSeconds: policy.cleanupDeadlineSeconds,
      enabled: true,
      firebaseValidationCooldownSeconds:
        policy.firebaseValidationCooldownSeconds,
      firebaseValidationDeadlineSeconds:
        policy.firebaseValidationDeadlineSeconds,
      maxSessionsDeployment: policy.maximumDeploymentSessions,
      maxSessionsPerIdentity: policy.maximumSessionsPerIdentity,
      metricsRetentionDays: policy.metricsRetentionDays,
      oidcClientId: configuration.oidcClientId,
      oidcGroupClaim: configuration.oidcGroupClaim,
      oidcIssuer: configuration.oidcIssuer,
      oidcRequiredGroup: configuration.oidcRequiredGroup,
      oidcScopes: configuration.oidcScopes,
      oidcTokenEndpointAuthMethod: configuration.oidcTokenEndpointAuthMethod,
      publicOrigin: configuration.publicOrigin,
      sessionAbsoluteSeconds: policy.sessionAbsoluteSeconds,
      sessionIdleSeconds: policy.sessionIdleSeconds,
    },
    credentials: {
      oidcClientSecret: {
        configured: true,
        source: configuration.oidcClientSecret.source,
      },
      sessionSecret: {
        configured: true,
        source: configuration.sessionSecret.source,
      },
    },
  };
}

export function loadAdministrationConfiguration(
  environment: ConfigurationEnvironment,
  options: LoadAdministrationConfigurationOptions,
): AdminConfigurationState {
  const enabled = ENABLED_SCHEMA.safeParse(
    environment.TRINITY_PUSH_GATEWAY_ADMIN_ENABLED ??
      ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_ENABLED,
  );
  if (!enabled.success) {
    return { kind: 'invalid' };
  }
  if (enabled.data === 'false') {
    return { kind: 'disabled' };
  }

  try {
    const publicOrigin = endpoint(
      environment.TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN,
      true,
    );
    const oidcIssuer = endpoint(
      environment.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER,
      false,
    );
    const oidcClientId = parsed(
      CLIENT_ID_SCHEMA,
      environment.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID,
    );
    const oidcClientSecret = secret(
      environment,
      'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET',
      options.readFile,
    );
    const sessionSecret = secret(
      environment,
      'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
      options.readFile,
      32,
    );
    const oidcRequiredGroup = parsed(
      REQUIRED_GROUP_SCHEMA,
      environment.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP,
    );
    const oidcGroupClaim = parsed(
      GROUP_CLAIM_SCHEMA,
      environment.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM ??
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM,
    );
    const oidcScopes = scopes(
      environment.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES ??
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES,
    );
    const oidcTokenEndpointAuthMethod =
      environment.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD ??
      ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD;
    const databasePath = parsed(
      PATH_SCHEMA,
      environment.TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH ??
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH,
    );
    const assetsPath = parsed(
      PATH_SCHEMA,
      environment.TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH ??
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH,
    );
    const migrationsPath = parsed(
      PATH_SCHEMA,
      environment.TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH ??
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH,
    );
    const backupDirectory = parsed(
      PATH_SCHEMA,
      environment.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY ??
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY,
    );
    const backupLimitCount = integer(
      environment.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT,
      ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT,
      1_000,
    );
    const backupLimitBytes = integer(
      environment.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_BYTES,
      ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_BYTES,
    );

    if (
      publicOrigin === undefined ||
      oidcIssuer === undefined ||
      oidcClientId === undefined ||
      oidcClientSecret === undefined ||
      sessionSecret === undefined ||
      oidcRequiredGroup === undefined ||
      oidcGroupClaim === undefined ||
      oidcScopes === undefined ||
      (oidcTokenEndpointAuthMethod !== 'client_secret_basic' &&
        oidcTokenEndpointAuthMethod !== 'client_secret_post') ||
      databasePath === undefined ||
      assetsPath === undefined ||
      migrationsPath === undefined ||
      backupDirectory === undefined ||
      backupLimitCount === undefined ||
      backupLimitBytes === undefined
    ) {
      return { kind: 'invalid' };
    }

    const configuration: AdminConfiguration = {
      assetsPath,
      backupDirectory,
      backupLimitBytes,
      backupLimitCount,
      databasePath,
      migrationsPath,
      oidcClientId,
      oidcClientSecret,
      oidcGroupClaim,
      oidcIssuer,
      oidcRequiredGroup,
      oidcScopes,
      oidcTokenEndpointAuthMethod,
      policy: ADMIN_POLICY_DEFAULTS,
      policyFingerprint: policyFingerprint(
        {
          oidcClientId,
          oidcGroupClaim,
          oidcIssuer,
          oidcRequiredGroup,
          oidcScopes,
          oidcTokenEndpointAuthMethod,
          publicOrigin,
        },
        options.sha256,
      ),
      publicOrigin,
      sessionSecret,
    };
    return {
      configuration,
      kind: 'enabled',
      safe: safeConfiguration(configuration),
    };
  } catch {
    return { kind: 'invalid' };
  }
}
