import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as z from 'zod/mini';

import {
  ADMINISTRATION_CONFIGURATION_CATALOG,
  type CatalogSafeAdministrationConfiguration,
  type CatalogSecret,
} from '../../configuration-catalog';

export {
  ADMIN_CONFIGURATION_ENVIRONMENT_NAMES,
  type AdminConfigurationEnvironmentName,
} from '../../admin-configuration-names';
import {
  ADMIN_CONFIGURATION_DEFAULTS,
  ADMIN_POLICY_DEFAULTS,
} from '../../configuration-defaults';

type Environment = Readonly<Record<string, string | undefined>>;
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

type LoadAdminConfigurationOptions = Readonly<{
  readFile?: (path: string) => string;
}>;

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
  environment: Environment,
  name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET',
  readFile: (path: string) => string,
): AdminSecret | undefined {
  const direct = environment[name];
  const file = environment[`${name}_FILE`];
  if (direct !== undefined && file !== undefined) {
    return undefined;
  }
  if (direct !== undefined) {
    return direct.length === 0 ? undefined : { source: 'env', value: direct };
  }
  if (file === undefined || file.length === 0) {
    return undefined;
  }
  const value = readFile(file).trimEnd();
  return value.length === 0 ? undefined : { source: 'file', value };
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

function policyFingerprint(input: {
  readonly oidcClientId: string;
  readonly oidcGroupClaim: string;
  readonly oidcIssuer: string;
  readonly oidcRequiredGroup: string;
  readonly oidcScopes: readonly string[];
  readonly oidcTokenEndpointAuthMethod: string;
  readonly publicOrigin: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...input,
        oidcScopes: [...input.oidcScopes].sort(),
        policy: ADMIN_POLICY_DEFAULTS,
      }),
    )
    .digest('hex');
}

function safeConfiguration(
  configuration: AdminConfiguration,
  catalogSafe: CatalogSafeAdministrationConfiguration,
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
      enabled: catalogSafe.administrationEnabled,
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
      sessionSecret: catalogSafe.sessionSecret,
    },
  };
}

export function loadAdminConfiguration(
  environment: Environment,
  options: LoadAdminConfigurationOptions = {},
): AdminConfigurationState {
  try {
    const readFile = options.readFile ?? ((path) => readFileSync(path, 'utf8'));
    const catalogState = ADMINISTRATION_CONFIGURATION_CATALOG.load(
      environment,
      { readFile },
    );
    if (catalogState.kind !== 'enabled') {
      return { kind: catalogState.kind };
    }
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
      readFile,
    );
    const sessionSecret = catalogState.configuration.sessionSecret;
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

    const fingerprint = policyFingerprint({
      oidcClientId,
      oidcGroupClaim,
      oidcIssuer,
      oidcRequiredGroup,
      oidcScopes,
      oidcTokenEndpointAuthMethod,
      publicOrigin,
    });
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
      policyFingerprint: fingerprint,
      publicOrigin,
      sessionSecret,
    };
    return {
      configuration,
      kind: 'enabled',
      safe: safeConfiguration(configuration, catalogState.safe),
    };
  } catch {
    return { kind: 'invalid' };
  }
}
