import type { AdminConfigurationEnvironmentName } from './admin-configuration-names';
import type { ConfigurationEnvironmentName } from './config';
import {
  ADMINISTRATION_CONFIGURATION_CATALOG,
  type ConfigurationCatalogReference,
} from './configuration-catalog';
import {
  ADMIN_CONFIGURATION_DEFAULTS,
  BUN_CONFIGURATION_DEFAULTS,
  SHARED_CONFIGURATION_DEFAULTS,
} from './configuration-defaults';

type BunOnlyConfigurationName =
  | AdminConfigurationEnvironmentName
  | 'TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS'
  | 'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER'
  | 'TRINITY_PUSH_GATEWAY_DATABASE_PATH'
  | 'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL_FILE'
  | 'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE'
  | 'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID_FILE'
  | 'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY_FILE'
  | 'TRINITY_PUSH_GATEWAY_HOST'
  | 'TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS'
  | 'TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH'
  | 'TRINITY_PUSH_GATEWAY_PORT'
  | 'TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT'
  | 'TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS'
  | 'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS';

type ComposeConfigurationName =
  'TRINITY_PUSH_GATEWAY_HOST_PORT' | 'TRINITY_PUSH_GATEWAY_VERSION';

export type GatewayConfigurationName =
  | ConfigurationEnvironmentName
  | BunOnlyConfigurationName
  | ComposeConfigurationName;

export type GatewayConfigurationReferenceEntry =
  ConfigurationCatalogReference<GatewayConfigurationName>;

const bothRuntimes = ['cloudflare', 'bun'] as const;
const bunRuntime = ['bun'] as const;

export const GATEWAY_CONFIGURATION_REFERENCE: readonly GatewayConfigurationReferenceEntry[] =
  [
    {
      name: 'TRINITY_PUSH_GATEWAY_ANDROID_APP_ID',
      description: 'Android application ID accepted by the gateway.',
      required: true,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Must differ from the iOS application ID.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_IOS_APP_ID',
      description: 'iOS application ID accepted by the gateway.',
      required: true,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Must differ from the Android application ID.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL',
      description: 'Client email from the dedicated Firebase service account.',
      required: true,
      runtimes: bothRuntimes,
      secret: true,
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY',
      description: 'Complete PEM private key for the Firebase service account.',
      required: true,
      runtimes: bothRuntimes,
      secret: true,
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID',
      description: 'Firebase project ID that owns both mobile applications.',
      required: true,
      runtimes: bothRuntimes,
      secret: true,
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY',
      description: 'Independent key used to fingerprint delivery attempts.',
      required: true,
      runtimes: bothRuntimes,
      secret: true,
      constraint: 'At least 32 UTF-8 bytes; do not reuse a Firebase secret.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES',
      description: 'Maximum accepted Matrix notification request size.',
      defaultValue:
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES,
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS',
      description: 'Maximum persisted FCM delivery attempts per UTC day.',
      defaultValue:
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS,
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_MAX_DEVICES',
      description: 'Maximum devices accepted in one Matrix notification.',
      defaultValue:
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_DEVICES,
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer no greater than 49.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
      description: 'Lease duration for an in-progress delivery.',
      defaultValue:
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS,
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer shorter than terminal retention.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
      description: 'Overall deadline for one gateway request.',
      defaultValue:
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS,
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer greater than the upstream timeout.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
      description: 'Retention time for completed delivery fingerprints.',
      defaultValue:
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS,
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer longer than the pending lease.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
      description: 'Timeout for Google OAuth and FCM requests.',
      defaultValue:
        SHARED_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS,
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer shorter than the request deadline.',
    },
    ...[
      [
        'TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL_FILE',
        'FCM client-email secret file.',
      ],
      [
        'TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY_FILE',
        'FCM private-key secret file.',
      ],
      [
        'TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID_FILE',
        'FCM project-ID secret file.',
      ],
      [
        'TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY_FILE',
        'Fingerprint-key secret file.',
      ],
    ].map(
      ([name, description]) =>
        ({
          name,
          description,
          required: false,
          runtimes: bunRuntime,
          secret: true,
          constraint: 'Mutually exclusive with the corresponding direct value.',
        }) as GatewayConfigurationReferenceEntry,
    ),
    {
      name: 'TRINITY_PUSH_GATEWAY_HOST',
      description: 'Address used by the Bun HTTP listener.',
      defaultValue: BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_HOST,
      required: false,
      runtimes: bunRuntime,
      secret: false,
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_PORT',
      description: 'Port used by the Bun HTTP listener.',
      defaultValue: BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_PORT,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Integer from 1 through 65535.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_DATABASE_PATH',
      description: 'Path to the persistent SQLite database.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_DATABASE_PATH,
      required: false,
      runtimes: bunRuntime,
      secret: false,
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH',
      description: 'Path containing forward-only SQL migrations.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MIGRATIONS_PATH,
      required: false,
      runtimes: bunRuntime,
      secret: false,
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT',
      description: 'Process-local request allowance per source period.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMIT,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS',
      description: 'Process-local source-rate window.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_SOURCE_RATE_PERIOD_SECONDS,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS',
      description: 'Maximum source keys retained by the process-local limiter.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_MAX_SOURCE_KEYS,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS',
      description: 'Interval between terminal-record cleanup passes.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_CLEANUP_INTERVAL_SECONDS,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER',
      description:
        'Forwarded client-address header trusted from configured proxies.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_CLIENT_IP_HEADER,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'x-forwarded-for or cf-connecting-ip.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS',
      description:
        'Comma-separated networks allowed to supply the client header.',
      defaultValue:
        BUN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS,
      required: false,
      runtimes: bunRuntime,
      secret: false,
    },
    ADMINISTRATION_CONFIGURATION_CATALOG.reference(
      'TRINITY_PUSH_GATEWAY_ADMIN_ENABLED',
    ),
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
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH',
      description: 'Path to the isolated administration SQLite database.',
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Absolute path distinct from the gateway database.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH',
      description: 'Internal directory containing production browser assets.',
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Absolute Bun-local path; excluded from the operator API.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH',
      description:
        'Internal directory containing administration database migrations.',
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Absolute Bun-local path; excluded from the operator API.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY',
      description: 'Directory for verified gateway-database backups.',
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Absolute path on the persistent local volume.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT',
      description: 'Maximum verified backups retained in the backup directory.',
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_COUNT,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'Positive integer no greater than 1000.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_BYTES',
      description: 'Maximum aggregate bytes allowed for verified backups.',
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_LIMIT_BYTES,
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
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint:
        'Unique scopes including openid; offline_access is forbidden.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM',
      description: 'Top-level ID-token claim containing exact group values.',
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM,
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
      defaultValue:
        ADMIN_CONFIGURATION_DEFAULTS.TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD,
      required: false,
      runtimes: bunRuntime,
      secret: false,
      constraint: 'client_secret_basic or client_secret_post.',
    },
    ADMINISTRATION_CONFIGURATION_CATALOG.reference(
      'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET',
    ),
    ADMINISTRATION_CONFIGURATION_CATALOG.reference(
      'TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET_FILE',
    ),
    {
      name: 'TRINITY_PUSH_GATEWAY_HOST_PORT',
      description: 'Loopback host port published by Docker Compose.',
      defaultValue: '3000',
      required: false,
      runtimes: ['compose'],
      secret: false,
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_VERSION',
      description: 'Container tag or digest selected by Docker Compose.',
      defaultValue: 'latest',
      required: false,
      runtimes: ['compose'],
      secret: false,
      constraint: 'Pin an immutable vX.Y.Z tag or digest in production.',
    },
  ];
