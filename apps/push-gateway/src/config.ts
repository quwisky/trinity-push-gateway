import * as z from 'zod/mini';

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

export type ConfigurationEnvironment = z.output<typeof ENV_SCHEMA>;
export type ConfigurationEnvironmentName =
  keyof typeof CONFIGURATION_ENVIRONMENT_SCHEMAS;

export const CONFIGURATION_ENVIRONMENT_NAMES: readonly ConfigurationEnvironmentName[] =
  Object.freeze(
    Object.keys(
      CONFIGURATION_ENVIRONMENT_SCHEMAS,
    ) as ConfigurationEnvironmentName[],
  );

export type RuntimeConfig = {
  readonly maxBodyBytes: number;
  readonly maxDailyAttempts: number;
  readonly maxDevices: number;
  readonly pendingLeaseSeconds: number;
  readonly requestDeadlineSeconds: number;
  readonly terminalRetentionSeconds: number;
  readonly upstreamTimeoutSeconds: number;
};

function positiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function runtimeConfig(
  env: ConfigurationEnvironment,
): RuntimeConfig | undefined {
  const result = z.safeParse(ENV_SCHEMA, env);
  if (!result.success) {
    return undefined;
  }
  const parsedEnv = result.data;
  const maxBodyBytes = positiveInteger(
    parsedEnv.TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES,
  );
  const maxDailyAttempts = positiveInteger(
    parsedEnv.TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS,
  );
  const maxDevices = positiveInteger(
    parsedEnv.TRINITY_PUSH_GATEWAY_MAX_DEVICES,
  );
  const pendingLeaseSeconds = positiveInteger(
    parsedEnv.TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS,
  );
  const requestDeadlineSeconds = positiveInteger(
    parsedEnv.TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS,
  );
  const terminalRetentionSeconds = positiveInteger(
    parsedEnv.TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS,
  );
  const upstreamTimeoutSeconds = positiveInteger(
    parsedEnv.TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS,
  );
  if (
    parsedEnv.TRINITY_PUSH_GATEWAY_ANDROID_APP_ID ===
      parsedEnv.TRINITY_PUSH_GATEWAY_IOS_APP_ID ||
    new TextEncoder().encode(parsedEnv.TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY)
      .byteLength < 32 ||
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
