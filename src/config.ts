import type { Env } from './env';

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
  const maxBodyBytes = positiveInteger(env.MAX_BODY_BYTES);
  const maxDailyAttempts = positiveInteger(env.MAX_DAILY_ATTEMPTS);
  const maxDevices = positiveInteger(env.MAX_DEVICES);
  const pendingLeaseSeconds = positiveInteger(env.PENDING_LEASE_SECONDS);
  const terminalRetentionSeconds = positiveInteger(
    env.TERMINAL_RETENTION_SECONDS,
  );
  if (
    env.ANDROID_APP_ID.length === 0 ||
    env.IOS_APP_ID.length === 0 ||
    env.ANDROID_APP_ID === env.IOS_APP_ID ||
    env.FCM_CLIENT_EMAIL.length === 0 ||
    env.FCM_PRIVATE_KEY.length === 0 ||
    env.FCM_PROJECT_ID.length === 0 ||
    new TextEncoder().encode(env.FINGERPRINT_KEY).byteLength < 32 ||
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
