export type Env = {
  readonly ANDROID_APP_ID: string;
  readonly DB: D1Database;
  readonly FCM_CLIENT_EMAIL: string;
  readonly FCM_PRIVATE_KEY: string;
  readonly FCM_PROJECT_ID: string;
  readonly FINGERPRINT_KEY: string;
  readonly IOS_APP_ID: string;
  readonly MAX_BODY_BYTES: string;
  readonly MAX_DAILY_ATTEMPTS: string;
  readonly MAX_DEVICES: string;
  readonly PENDING_LEASE_SECONDS: string;
  readonly SOURCE_RATE_LIMITER: RateLimit;
  readonly TERMINAL_RETENTION_SECONDS: string;
};
