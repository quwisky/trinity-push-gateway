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

const ADMIN_OPERATION_SUMMARY_SCHEMA = z.strictObject({
  completedAt: UTC_TIMESTAMP,
  cooldownEndsAt: UTC_TIMESTAMP,
  outcome: z.enum(['succeeded', 'failed', 'outcome_unknown']),
  reason: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{0,63}$/u))),
  startedAt: UTC_TIMESTAMP,
});

export const ADMIN_OPERATION_RESULT_SCHEMA = z.strictObject({
  completedAt: UTC_TIMESTAMP,
  cooldownEndsAt: UTC_TIMESTAMP,
  outcome: z.enum(['succeeded', 'failed']),
  reason: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{0,63}$/u))),
  startedAt: UTC_TIMESTAMP,
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
  lastBackup: z.optional(ADMIN_OPERATION_SUMMARY_SCHEMA),
  lastCleanup: z.optional(ADMIN_OPERATION_SUMMARY_SCHEMA),
  lastFirebaseValidation: z.optional(ADMIN_OPERATION_SUMMARY_SCHEMA),
  observedAt: UTC_TIMESTAMP,
  requestsLast24Hours: REQUEST_OUTCOME_COUNTS_SCHEMA,
  uptimeSeconds: SAFE_COUNT,
  version: z.string().check(z.minLength(1), z.maxLength(128)),
});

const LATENCY_HISTOGRAM_SCHEMA = z.strictObject({
  '1000_to_2499_ms': SAFE_COUNT,
  '10000_ms_or_more': SAFE_COUNT,
  '100_to_249_ms': SAFE_COUNT,
  '2500_to_4999_ms': SAFE_COUNT,
  '250_to_499_ms': SAFE_COUNT,
  '5000_to_9999_ms': SAFE_COUNT,
  '500_to_999_ms': SAFE_COUNT,
  under_100_ms: SAFE_COUNT,
});

export const ADMIN_METRICS_SCHEMA = z.strictObject({
  fcmBuckets: z
    .array(
      z.strictObject({
        from: UTC_TIMESTAMP,
        latency: z.strictObject({
          approxP95Ms: z.nullable(
            z.number().check(z.int(), z.gte(0), z.lte(10_000)),
          ),
          histogram: LATENCY_HISTOGRAM_SCHEMA,
          sampleCount: SAFE_COUNT,
        }),
        outcomes: FCM_OUTCOME_COUNTS_SCHEMA,
        platform: z.enum(['android', 'ios']),
        to: UTC_TIMESTAMP,
      }),
    )
    .check(z.maxLength(1_440)),
  from: UTC_TIMESTAMP,
  interval: z.enum(['hour', 'day']),
  requestBuckets: z
    .array(
      z.strictObject({
        from: UTC_TIMESTAMP,
        outcomes: REQUEST_OUTCOME_COUNTS_SCHEMA,
        to: UTC_TIMESTAMP,
      }),
    )
    .check(z.maxLength(720)),
  to: UTC_TIMESTAMP,
});

const ADMIN_AUDIT_ENTRY_SCHEMA = z.strictObject({
  id: z.string().check(z.minLength(16), z.maxLength(128)),
  kind: z.enum([
    'login',
    'logout',
    'session_expired',
    'session_revoked',
    'session_cap_eviction',
    'policy_rejected',
    'session_purge',
    'firebase_validation',
    'cleanup',
    'backup',
  ]),
  occurredAt: UTC_TIMESTAMP,
  operator: z.nullable(ADMIN_OPERATOR_IDENTITY_SCHEMA),
  outcome: z.enum(['succeeded', 'failed', 'started', 'outcome_unknown']),
  reason: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{0,63}$/u))),
});

export const ADMIN_AUDIT_PAGE_SCHEMA = z.strictObject({
  entries: z.array(ADMIN_AUDIT_ENTRY_SCHEMA).check(z.maxLength(100)),
  nextCursor: z.optional(z.string().check(z.minLength(1), z.maxLength(2048))),
});

export const ADMIN_BACKUP_SCHEMA = z.strictObject({
  createdAt: UTC_TIMESTAMP,
  id: z.string().check(z.minLength(16), z.maxLength(128)),
  integrity: z.literal('verified'),
  name: z.string().check(z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u)),
  operator: z.nullable(ADMIN_OPERATOR_IDENTITY_SCHEMA),
  sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  sizeBytes: POSITIVE_SAFE_INTEGER,
});

export const ADMIN_BACKUP_LIST_SCHEMA = z.strictObject({
  backups: z.array(ADMIN_BACKUP_SCHEMA).check(z.maxLength(1_000)),
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
