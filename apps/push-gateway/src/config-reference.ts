import type { ConfigurationEnvironmentName } from './config';

type BunOnlyConfigurationName =
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

export type GatewayConfigurationReferenceEntry = Readonly<{
  constraint?: string;
  defaultValue?: string;
  description: string;
  name: GatewayConfigurationName;
  required: boolean;
  runtimes: readonly ('bun' | 'cloudflare' | 'compose')[];
  secret: boolean;
}>;

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
      defaultValue: '65536',
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS',
      description: 'Maximum persisted FCM delivery attempts per UTC day.',
      defaultValue: '20000',
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_MAX_DEVICES',
      description: 'Maximum devices accepted in one Matrix notification.',
      defaultValue: '49',
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer no greater than 49.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS',
      description: 'Lease duration for an in-progress delivery.',
      defaultValue: '120',
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer shorter than terminal retention.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS',
      description: 'Overall deadline for one gateway request.',
      defaultValue: '30',
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer greater than the upstream timeout.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS',
      description: 'Retention time for completed delivery fingerprints.',
      defaultValue: '86400',
      required: false,
      runtimes: bothRuntimes,
      secret: false,
      constraint: 'Positive integer longer than the pending lease.',
    },
    {
      name: 'TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS',
      description: 'Timeout for Google OAuth and FCM requests.',
      defaultValue: '10',
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
