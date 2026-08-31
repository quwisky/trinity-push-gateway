import {
  loadSharedRuntimeConfiguration,
  sharedConfigurationDefault,
  type SharedConfigurationEnvironment,
} from './shared';
import {
  catalogDefaults,
  resolveCatalogSecret,
  type ConfigurationEnvironment,
} from './types';

const bunRuntime = ['bun'] as const;

export const BUN_CONFIGURATION_DEFINITIONS = Object.freeze([
  {
    name: 'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL_FILE',
    description: 'FCM client-email secret file.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint: 'Mutually exclusive with the corresponding direct value.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE',
    description: 'FCM private-key secret file.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint: 'Mutually exclusive with the corresponding direct value.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID_FILE',
    description: 'FCM project-ID secret file.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint: 'Mutually exclusive with the corresponding direct value.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY_FILE',
    description: 'Fingerprint-key secret file.',
    required: false,
    runtimes: bunRuntime,
    secret: true,
    constraint: 'Mutually exclusive with the corresponding direct value.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_HOST',
    description: 'Address used by the Bun HTTP listener.',
    defaultValue: '0.0.0.0',
    required: false,
    runtimes: bunRuntime,
    secret: false,
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_PORT',
    description: 'Port used by the Bun HTTP listener.',
    defaultValue: '3000',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Integer from 1 through 65535.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_DATABASE_PATH',
    description: 'Path to the persistent SQLite database.',
    defaultValue: '/data/gateway.sqlite',
    required: false,
    runtimes: bunRuntime,
    secret: false,
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH',
    description: 'Path containing forward-only SQL migrations.',
    defaultValue: '/app/migrations',
    required: false,
    runtimes: bunRuntime,
    secret: false,
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT',
    description: 'Process-local request allowance per source period.',
    defaultValue: '300',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Positive integer.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS',
    description: 'Process-local source-rate window.',
    defaultValue: '10',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Positive integer.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS',
    description: 'Maximum source keys retained by the process-local limiter.',
    defaultValue: '10000',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Positive integer.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS',
    description: 'Interval between terminal-record cleanup passes.',
    defaultValue: '86400',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'Positive integer.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER',
    description:
      'Forwarded client-address header trusted from configured proxies.',
    defaultValue: 'x-forwarded-for',
    required: false,
    runtimes: bunRuntime,
    secret: false,
    constraint: 'x-forwarded-for or cf-connecting-ip.',
  },
  {
    name: 'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS',
    description:
      'Comma-separated networks allowed to supply the client header.',
    defaultValue: '',
    required: false,
    runtimes: bunRuntime,
    secret: false,
  },
] as const);

const BUN_CONFIGURATION_DEFAULTS = catalogDefaults(
  BUN_CONFIGURATION_DEFINITIONS,
);

export type CredentialSource = 'env' | 'file';

export type GatewayCredentialSources = Readonly<{
  firebaseClientEmail: CredentialSource;
  firebasePrivateKey: CredentialSource;
  firebaseProjectId: CredentialSource;
  fingerprintKey: CredentialSource;
}>;

export type ClientIpHeader = 'cf-connecting-ip' | 'x-forwarded-for';

type SafeSecretPresence = Readonly<{
  configured: true;
  source: CredentialSource;
}>;

export type SafeBunRuntimeConfiguration = Readonly<{
  credentials: Readonly<{
    firebaseClientEmail: SafeSecretPresence;
    firebasePrivateKey: SafeSecretPresence;
    firebaseProjectId: SafeSecretPresence;
    fingerprintKey: SafeSecretPresence;
  }>;
  gateway: Readonly<{
    androidApplicationId: string;
    cleanupIntervalSeconds: number;
    firebaseProjectId: string;
    gatewayDatabasePath: string;
    iosApplicationId: string;
    maxBodyBytes: number;
    maxClientInstallationsPerRequest: number;
    maxDailyAttempts: number;
    maxSourceKeys: number;
    pendingLeaseSeconds: number;
    requestDeadlineSeconds: number;
    sourceRateLimit: number;
    sourceRatePeriodSeconds: number;
    terminalRetentionSeconds: number;
    upstreamTimeoutSeconds: number;
  }>;
}>;

export type BunRuntimeConfiguration = Readonly<{
  cleanupIntervalSeconds: number;
  clientIpHeader: ClientIpHeader;
  credentialSources: GatewayCredentialSources;
  databasePath: string;
  environment: SharedConfigurationEnvironment;
  host: string;
  maxSourceKeys: number;
  migrationsPath: string;
  port: number;
  safe: SafeBunRuntimeConfiguration;
  sourceLimit: number;
  sourcePeriodSeconds: number;
  trustedProxyCidrs: readonly string[];
}>;

type LoadBunRuntimeConfigurationOptions = Readonly<{
  readFile: (path: string) => string;
  trustedProxyConfigurationValid: (cidrs: readonly string[]) => boolean;
}>;

function required(environment: ConfigurationEnvironment, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function credential(
  environment: ConfigurationEnvironment,
  name: string,
  readFile: (path: string) => string,
): string {
  const fileName = `${name}_FILE`;
  const resolution = resolveCatalogSecret(environment, name, readFile);
  if (resolution.kind === 'resolved') {
    return resolution.secret.value;
  }
  if (resolution.reason === 'conflicting-sources') {
    throw new Error(`${name} and ${fileName} cannot both be set.`);
  }
  if (resolution.reason === 'empty-file-name') {
    throw new Error(`${fileName} cannot be empty.`);
  }
  if (resolution.reason === 'value-too-short' && resolution.source === 'file') {
    throw new Error(`${fileName} contains an empty value.`);
  }
  return required(environment, name);
}

function credentialSource(
  environment: ConfigurationEnvironment,
  name: string,
): CredentialSource {
  return environment[`${name}_FILE`] === undefined ? 'env' : 'file';
}

function positiveInteger(
  environment: ConfigurationEnvironment,
  name: string,
  fallback: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = environment[name] ?? fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(
      `${name} must be a positive integer no greater than ${String(maximum)}.`,
    );
  }
  return parsed;
}

export function loadBunRuntimeConfiguration(
  environment: ConfigurationEnvironment,
  options: LoadBunRuntimeConfigurationOptions,
): BunRuntimeConfiguration {
  const runtimeEnvironment: SharedConfigurationEnvironment = {
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: required(
      environment,
      'TRINITY_PUSH_GATEWAY_ANDROID_APP_ID',
    ),
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL',
      options.readFile,
    ),
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY',
      options.readFile,
    ),
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID',
      options.readFile,
    ),
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: credential(
      environment,
      'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY',
      options.readFile,
    ),
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: required(
      environment,
      'TRINITY_PUSH_GATEWAY_IOS_APP_ID',
    ),
    TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES',
        sharedConfigurationDefault('TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES'),
      ),
    ),
    TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS',
        sharedConfigurationDefault('TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS'),
      ),
    ),
    TRINITY_PUSH_GATEWAY_MAX_DEVICES: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_MAX_DEVICES',
        sharedConfigurationDefault('TRINITY_PUSH_GATEWAY_MAX_DEVICES'),
        49,
      ),
    ),
    TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
        sharedConfigurationDefault(
          'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
        ),
      ),
    ),
    TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
        sharedConfigurationDefault(
          'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
        ),
      ),
    ),
    TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
        sharedConfigurationDefault(
          'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
        ),
      ),
    ),
    TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: String(
      positiveInteger(
        environment,
        'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
        sharedConfigurationDefault(
          'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
        ),
      ),
    ),
  };
  const sharedRuntime = loadSharedRuntimeConfiguration(runtimeEnvironment);
  if (sharedRuntime === undefined) {
    throw new Error('Gateway runtime configuration is invalid.');
  }

  const clientIpHeader =
    environment.TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER ??
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER;
  if (
    clientIpHeader !== 'x-forwarded-for' &&
    clientIpHeader !== 'cf-connecting-ip'
  ) {
    throw new Error(
      'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER must be x-forwarded-for or cf-connecting-ip.',
    );
  }
  const trustedProxyCidrs = (
    environment.TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS ??
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS
  )
    .split(',')
    .map((cidr) => cidr.trim())
    .filter((cidr) => cidr.length > 0);
  if (!options.trustedProxyConfigurationValid(trustedProxyCidrs)) {
    throw new Error(
      'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS contains an invalid network.',
    );
  }

  const cleanupIntervalSeconds = positiveInteger(
    environment,
    'TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS',
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS,
  );
  const credentialSources = {
    firebaseClientEmail: credentialSource(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL',
    ),
    firebasePrivateKey: credentialSource(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY',
    ),
    firebaseProjectId: credentialSource(
      environment,
      'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID',
    ),
    fingerprintKey: credentialSource(
      environment,
      'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY',
    ),
  } as const;
  const databasePath =
    environment.TRINITY_PUSH_GATEWAY_DATABASE_PATH ??
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_DATABASE_PATH;
  const maxSourceKeys = positiveInteger(
    environment,
    'TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS',
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS,
  );
  const sourceLimit = positiveInteger(
    environment,
    'TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT',
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT,
  );
  const sourcePeriodSeconds = positiveInteger(
    environment,
    'TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS',
    BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS,
  );

  return {
    cleanupIntervalSeconds,
    clientIpHeader,
    credentialSources,
    databasePath,
    environment: runtimeEnvironment,
    host:
      environment.TRINITY_PUSH_GATEWAY_HOST ??
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_HOST,
    maxSourceKeys,
    migrationsPath:
      environment.TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH ??
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH,
    port: positiveInteger(
      environment,
      'TRINITY_PUSH_GATEWAY_PORT',
      BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_PORT,
      65_535,
    ),
    safe: {
      credentials: {
        firebaseClientEmail: {
          configured: true,
          source: credentialSources.firebaseClientEmail,
        },
        firebasePrivateKey: {
          configured: true,
          source: credentialSources.firebasePrivateKey,
        },
        firebaseProjectId: {
          configured: true,
          source: credentialSources.firebaseProjectId,
        },
        fingerprintKey: {
          configured: true,
          source: credentialSources.fingerprintKey,
        },
      },
      gateway: {
        androidApplicationId:
          runtimeEnvironment.TRINITY_PUSH_GATEWAY_ANDROID_APP_ID,
        cleanupIntervalSeconds,
        firebaseProjectId:
          runtimeEnvironment.TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID,
        gatewayDatabasePath: databasePath,
        iosApplicationId: runtimeEnvironment.TRINITY_PUSH_GATEWAY_IOS_APP_ID,
        maxBodyBytes: sharedRuntime.maxBodyBytes,
        maxClientInstallationsPerRequest: sharedRuntime.maxDevices,
        maxDailyAttempts: sharedRuntime.maxDailyAttempts,
        maxSourceKeys,
        pendingLeaseSeconds: sharedRuntime.pendingLeaseSeconds,
        requestDeadlineSeconds: sharedRuntime.requestDeadlineSeconds,
        sourceRateLimit: sourceLimit,
        sourceRatePeriodSeconds: sourcePeriodSeconds,
        terminalRetentionSeconds: sharedRuntime.terminalRetentionSeconds,
        upstreamTimeoutSeconds: sharedRuntime.upstreamTimeoutSeconds,
      },
    },
    sourceLimit,
    sourcePeriodSeconds,
    trustedProxyCidrs,
  };
}
