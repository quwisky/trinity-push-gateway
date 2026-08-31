import * as z from 'zod/mini';

import { catalogDefaults } from './types';

const bothRuntimes = ['cloudflare', 'bun'] as const;

export const SHARED_CONFIGURATION_DEFINITIONS = Object.freeze([
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
] as const);

export type ConfigurationEnvironmentName =
  (typeof SHARED_CONFIGURATION_DEFINITIONS)[number]['name'];

const NON_EMPTY_STRING_SCHEMA = z.string().check(z.minLength(1));
const POSITIVE_INTEGER_STRING_SCHEMA = z.string().check(z.regex(/^[1-9]\d*$/u));
const CONFIGURATION_ENVIRONMENT_SCHEMAS = {
  TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: NON_EMPTY_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: NON_EMPTY_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: NON_EMPTY_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: NON_EMPTY_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: NON_EMPTY_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_IOS_APP_ID: NON_EMPTY_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES: POSITIVE_INTEGER_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: POSITIVE_INTEGER_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_MAX_DEVICES: POSITIVE_INTEGER_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS: POSITIVE_INTEGER_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: POSITIVE_INTEGER_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS:
    POSITIVE_INTEGER_STRING_SCHEMA,
  TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: POSITIVE_INTEGER_STRING_SCHEMA,
};
const ENV_SCHEMA = z.looseObject(CONFIGURATION_ENVIRONMENT_SCHEMAS);

export type SharedConfigurationEnvironment = z.output<typeof ENV_SCHEMA>;

export const CONFIGURATION_ENVIRONMENT_NAMES = Object.freeze(
  SHARED_CONFIGURATION_DEFINITIONS.map(({ name }) => name),
);
export const SHARED_CONFIGURATION_DEFAULTS = catalogDefaults(
  SHARED_CONFIGURATION_DEFINITIONS,
);

export type RuntimeConfig = Readonly<{
  maxBodyBytes: number;
  maxDailyAttempts: number;
  maxDevices: number;
  pendingLeaseSeconds: number;
  requestDeadlineSeconds: number;
  terminalRetentionSeconds: number;
  upstreamTimeoutSeconds: number;
}>;

function positiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function loadSharedRuntimeConfiguration(
  environment: SharedConfigurationEnvironment,
): RuntimeConfig | undefined {
  const result = z.safeParse(ENV_SCHEMA, environment);
  if (!result.success) {
    return undefined;
  }
  const parsedEnvironment = result.data;
  const maxBodyBytes = positiveInteger(
    parsedEnvironment.TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES,
  );
  const maxDailyAttempts = positiveInteger(
    parsedEnvironment.TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS,
  );
  const maxDevices = positiveInteger(
    parsedEnvironment.TRINITY_PUSH_GATEWAY_MAX_DEVICES,
  );
  const pendingLeaseSeconds = positiveInteger(
    parsedEnvironment.TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS,
  );
  const requestDeadlineSeconds = positiveInteger(
    parsedEnvironment.TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS,
  );
  const terminalRetentionSeconds = positiveInteger(
    parsedEnvironment.TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS,
  );
  const upstreamTimeoutSeconds = positiveInteger(
    parsedEnvironment.TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS,
  );
  if (
    parsedEnvironment.TRINITY_PUSH_GATEWAY_ANDROID_APP_ID ===
      parsedEnvironment.TRINITY_PUSH_GATEWAY_IOS_APP_ID ||
    new TextEncoder().encode(
      parsedEnvironment.TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY,
    ).byteLength < 32 ||
    maxBodyBytes === undefined ||
    maxDailyAttempts === undefined ||
    maxDevices === undefined ||
    maxDevices > 49 ||
    pendingLeaseSeconds === undefined ||
    requestDeadlineSeconds === undefined ||
    terminalRetentionSeconds === undefined ||
    terminalRetentionSeconds <= pendingLeaseSeconds ||
    upstreamTimeoutSeconds === undefined ||
    upstreamTimeoutSeconds >= requestDeadlineSeconds
  ) {
    return undefined;
  }
  return {
    maxBodyBytes,
    maxDailyAttempts,
    maxDevices,
    pendingLeaseSeconds,
    requestDeadlineSeconds,
    terminalRetentionSeconds,
    upstreamTimeoutSeconds,
  };
}
