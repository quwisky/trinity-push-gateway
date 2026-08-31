import * as z from 'zod/mini';

const SAFE_COUNT = z.number().check(z.int(), z.nonnegative());
const POSITIVE_SAFE_INTEGER = z.number().check(z.int(), z.positive());
const UTC_TIMESTAMP = z
  .string()
  .check(z.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u));

export const ADMIN_SESSION_ID_SCHEMA = z
  .string()
  .check(z.regex(/^[A-Za-z0-9_-]{16,128}$/u));

export const ADMIN_OPERATOR_IDENTITY_SCHEMA = z.strictObject({
  displayName: z.optional(z.string().check(z.minLength(1), z.maxLength(256))),
  email: z.optional(z.email().check(z.minLength(3), z.maxLength(320))),
  issuer: z.string().check(z.minLength(1), z.maxLength(2048)),
  subject: z.string().check(z.minLength(1), z.maxLength(512)),
});

export const ADMIN_OPERATOR_SESSION_SCHEMA = z.strictObject({
  absoluteExpiresAt: UTC_TIMESTAMP,
  createdAt: UTC_TIMESTAMP,
  current: z.boolean(),
  id: ADMIN_SESSION_ID_SCHEMA,
  idleExpiresAt: UTC_TIMESTAMP,
  lastSeenAt: UTC_TIMESTAMP,
  operator: ADMIN_OPERATOR_IDENTITY_SCHEMA,
});

export const ADMIN_OPERATOR_SESSION_LIST_SCHEMA = z.strictObject({
  sessions: z.array(ADMIN_OPERATOR_SESSION_SCHEMA).check(z.maxLength(100)),
});

const REQUEST_OUTCOME_COUNTS_SCHEMA = z.strictObject({
  invalid: SAFE_COUNT,
  processed: SAFE_COUNT,
  rateLimited: SAFE_COUNT,
  safetyBudgetExhausted: SAFE_COUNT,
  storageUnavailable: SAFE_COUNT,
});

const FCM_OUTCOME_COUNTS_SCHEMA = z.strictObject({
  accepted: SAFE_COUNT,
  attempted: SAFE_COUNT,
  permanentlyRejected: SAFE_COUNT,
  transientFailure: SAFE_COUNT,
});

export const ADMIN_OVERVIEW_SCHEMA = z.strictObject({
  administrationReady: z.boolean(),
  databaseBytes: z.strictObject({
    administration: SAFE_COUNT,
    gateway: SAFE_COUNT,
  }),
  fcmAttemptsLast24Hours: z.strictObject({
    android: FCM_OUTCOME_COUNTS_SCHEMA,
    ios: FCM_OUTCOME_COUNTS_SCHEMA,
  }),
  gatewayReady: z.boolean(),
  observedAt: UTC_TIMESTAMP,
  requestsLast24Hours: REQUEST_OUTCOME_COUNTS_SCHEMA,
  uptimeSeconds: SAFE_COUNT,
  version: z.string().check(z.minLength(1), z.maxLength(128)),
});

const SECRET_PRESENCE_SCHEMA = z.strictObject({
  configured: z.boolean(),
  source: z.enum(['env', 'file']),
});

export const ADMIN_CONFIGURATION_RESPONSE_SCHEMA = z.strictObject({
  administration: z.strictObject({
    administrationDatabasePath: z.string().check(z.regex(/^\//u)),
    auditRetentionDays: POSITIVE_SAFE_INTEGER,
    backupCooldownSeconds: POSITIVE_SAFE_INTEGER,
    backupDeadlineSeconds: POSITIVE_SAFE_INTEGER,
    backupDirectory: z.string().check(z.regex(/^\//u)),
    backupLimitBytes: POSITIVE_SAFE_INTEGER,
    backupLimitCount: z.number().check(z.int(), z.gte(1), z.lte(1_000)),
    cleanupCooldownSeconds: POSITIVE_SAFE_INTEGER,
    cleanupDeadlineSeconds: POSITIVE_SAFE_INTEGER,
    firebaseValidationCooldownSeconds: POSITIVE_SAFE_INTEGER,
    firebaseValidationDeadlineSeconds: POSITIVE_SAFE_INTEGER,
    maxSessionsDeployment: z.literal(100),
    maxSessionsPerIdentity: z.literal(5),
    metricsRetentionDays: POSITIVE_SAFE_INTEGER,
    oidcClientId: z.string().check(z.minLength(1), z.maxLength(512)),
    oidcGroupClaim: z
      .string()
      .check(z.regex(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/u)),
    oidcIssuer: z.string().check(z.minLength(1), z.maxLength(2048)),
    oidcRequiredGroup: z.string().check(z.minLength(1), z.maxLength(256)),
    oidcScopes: z
      .array(z.string().check(z.regex(/^[A-Za-z0-9._:-]{1,128}$/u)))
      .check(z.minLength(1), z.maxLength(16)),
    oidcTokenEndpointAuthMethod: z.enum([
      'client_secret_basic',
      'client_secret_post',
    ]),
    publicOrigin: z.string().check(z.minLength(8), z.maxLength(2048)),
    sessionAbsoluteSeconds: z.literal(28_800),
    sessionIdleSeconds: z.literal(1_800),
  }),
  credentials: z.strictObject({
    firebaseClientEmail: SECRET_PRESENCE_SCHEMA,
    firebasePrivateKey: SECRET_PRESENCE_SCHEMA,
    firebaseProjectId: SECRET_PRESENCE_SCHEMA,
    fingerprintKey: SECRET_PRESENCE_SCHEMA,
    oidcClientSecret: SECRET_PRESENCE_SCHEMA,
    sessionSecret: SECRET_PRESENCE_SCHEMA,
  }),
  gateway: z.strictObject({
    androidApplicationId: z.string().check(z.minLength(1), z.maxLength(255)),
    cleanupIntervalSeconds: POSITIVE_SAFE_INTEGER,
    firebaseProjectId: z.string().check(z.minLength(1), z.maxLength(255)),
    gatewayDatabasePath: z.string().check(z.regex(/^\//u)),
    iosApplicationId: z.string().check(z.minLength(1), z.maxLength(255)),
    maxBodyBytes: POSITIVE_SAFE_INTEGER,
    maxClientInstallationsPerRequest: z
      .number()
      .check(z.int(), z.gte(1), z.lte(49)),
    maxDailyAttempts: POSITIVE_SAFE_INTEGER,
    maxSourceKeys: POSITIVE_SAFE_INTEGER,
    pendingLeaseSeconds: POSITIVE_SAFE_INTEGER,
    requestDeadlineSeconds: POSITIVE_SAFE_INTEGER,
    sourceRateLimit: POSITIVE_SAFE_INTEGER,
    sourceRatePeriodSeconds: POSITIVE_SAFE_INTEGER,
    terminalRetentionSeconds: POSITIVE_SAFE_INTEGER,
    upstreamTimeoutSeconds: POSITIVE_SAFE_INTEGER,
  }),
  observedAt: UTC_TIMESTAMP,
  version: z.string().check(z.minLength(1), z.maxLength(128)),
});

export function validatedAdminResponse<T>(
  schema: z.ZodMiniType<T>,
  value: unknown,
): T {
  const result = z.safeParse(schema, value);
  if (!result.success) {
    throw new Error('Administration response projection is invalid.');
  }
  return result.data;
}
