import {
  looseObject,
  minLength,
  pipe,
  regex,
  safeParse,
  string,
} from 'valibot';

import type { Env } from './env';

const NON_EMPTY_STRING_SCHEMA = pipe(string(), minLength(1));
const POSITIVE_INTEGER_STRING_SCHEMA = pipe(string(), regex(/^[1-9]\d*$/u));
const ENV_SCHEMA = looseObject({
  ANDROID_APP_ID: NON_EMPTY_STRING_SCHEMA,
  FCM_CLIENT_EMAIL: NON_EMPTY_STRING_SCHEMA,
  FCM_PRIVATE_KEY: NON_EMPTY_STRING_SCHEMA,
  FCM_PROJECT_ID: NON_EMPTY_STRING_SCHEMA,
  FINGERPRINT_KEY: NON_EMPTY_STRING_SCHEMA,
  IOS_APP_ID: NON_EMPTY_STRING_SCHEMA,
  MAX_BODY_BYTES: POSITIVE_INTEGER_STRING_SCHEMA,
  MAX_DAILY_ATTEMPTS: POSITIVE_INTEGER_STRING_SCHEMA,
  MAX_DEVICES: POSITIVE_INTEGER_STRING_SCHEMA,
  PENDING_LEASE_SECONDS: POSITIVE_INTEGER_STRING_SCHEMA,
  TERMINAL_RETENTION_SECONDS: POSITIVE_INTEGER_STRING_SCHEMA,
});

export type RuntimeConfig = {
  readonly maxBodyBytes: number;
  readonly maxDailyAttempts: number;
  readonly maxDevices: number;
  readonly pendingLeaseSeconds: number;
  readonly terminalRetentionSeconds: number;
};

function positiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function runtimeConfig(env: Env): RuntimeConfig | undefined {
  const result = safeParse(ENV_SCHEMA, env);
  if (!result.success) {
    return undefined;
  }
  const parsedEnv = result.output;
  const maxBodyBytes = positiveInteger(parsedEnv.MAX_BODY_BYTES);
  const maxDailyAttempts = positiveInteger(parsedEnv.MAX_DAILY_ATTEMPTS);
  const maxDevices = positiveInteger(parsedEnv.MAX_DEVICES);
  const pendingLeaseSeconds = positiveInteger(parsedEnv.PENDING_LEASE_SECONDS);
  const terminalRetentionSeconds = positiveInteger(
    parsedEnv.TERMINAL_RETENTION_SECONDS,
  );
  if (
    parsedEnv.ANDROID_APP_ID === parsedEnv.IOS_APP_ID ||
    new TextEncoder().encode(parsedEnv.FINGERPRINT_KEY).byteLength < 32 ||
    maxBodyBytes === undefined ||
    maxDailyAttempts === undefined ||
    maxDevices === undefined ||
    maxDevices > 49 ||
    pendingLeaseSeconds === undefined ||
    terminalRetentionSeconds === undefined ||
    terminalRetentionSeconds <= pendingLeaseSeconds
  ) {
    return undefined;
  }
  return {
    maxBodyBytes,
    maxDailyAttempts,
    maxDevices,
    pendingLeaseSeconds,
    terminalRetentionSeconds,
  };
}
