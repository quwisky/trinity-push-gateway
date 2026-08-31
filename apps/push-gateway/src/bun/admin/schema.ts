import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const ADMIN_AUDIT_KINDS = [
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
] as const;

export const ADMIN_AUDIT_OUTCOMES = [
  'succeeded',
  'failed',
  'started',
  'outcome_unknown',
] as const;

export const ADMIN_OPERATION_KINDS = [
  'firebase_validation',
  'cleanup',
  'backup',
] as const;

export const DELIVERY_PLATFORMS = ['android', 'ios'] as const;

export const operatorIdentities = sqliteTable(
  'operator_identities',
  {
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    displayName: text('display_name'),
    email: text('email'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.issuer, table.subject] }),
    check(
      'operator_identities_timestamps_check',
      sql`${table.createdAt} >= 0 AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      'operator_identities_values_check',
      sql`length(${table.issuer}) BETWEEN 1 AND 2048
        AND length(${table.subject}) BETWEEN 1 AND 512
        AND (${table.displayName} IS NULL OR length(${table.displayName}) BETWEEN 1 AND 256)
        AND (${table.email} IS NULL OR length(${table.email}) BETWEEN 3 AND 320)`,
    ),
  ],
);

export const operatorSessions = sqliteTable(
  'operator_sessions',
  {
    id: text('id').primaryKey(),
    sessionDigest: text('session_digest').notNull(),
    xsrfDigest: text('xsrf_digest').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    idleExpiresAt: integer('idle_expires_at').notNull(),
    absoluteExpiresAt: integer('absolute_expires_at').notNull(),
    policyFingerprint: text('policy_fingerprint').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (table) => [
    uniqueIndex('operator_sessions_session_digest_idx').on(table.sessionDigest),
    uniqueIndex('operator_sessions_xsrf_digest_idx').on(table.xsrfDigest),
    index('operator_sessions_identity_idx').on(
      table.issuer,
      table.subject,
      table.createdAt,
      table.id,
    ),
    index('operator_sessions_last_seen_idx').on(table.lastSeenAt, table.id),
    index('operator_sessions_expiry_idx').on(
      table.idleExpiresAt,
      table.absoluteExpiresAt,
    ),
    foreignKey({
      columns: [table.issuer, table.subject],
      foreignColumns: [operatorIdentities.issuer, operatorIdentities.subject],
      name: 'operator_sessions_identity_fk',
    }).onDelete('restrict'),
    check(
      'operator_sessions_timestamps_check',
      sql`${table.createdAt} >= 0
        AND ${table.lastSeenAt} >= ${table.createdAt}
        AND ${table.idleExpiresAt} > ${table.createdAt}
        AND ${table.absoluteExpiresAt} > ${table.createdAt}
        AND ${table.idleExpiresAt} <= ${table.absoluteExpiresAt}
        AND (${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt})`,
    ),
    check(
      'operator_sessions_values_check',
      sql`length(${table.id}) BETWEEN 16 AND 128
        AND length(${table.sessionDigest}) >= 1
        AND length(${table.xsrfDigest}) >= 1
        AND ${table.sessionDigest} <> ${table.xsrfDigest}
        AND length(${table.policyFingerprint}) >= 1`,
    ),
  ],
);

export const oidcLoginAttempts = sqliteTable(
  'oidc_login_attempts',
  {
    stateDigest: text('state_digest').primaryKey(),
    cookieDigest: text('cookie_digest'),
    codeVerifier: text('code_verifier').notNull(),
    nonce: text('nonce').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    uniqueIndex('oidc_login_attempts_cookie_digest_idx').on(table.cookieDigest),
    index('oidc_login_attempts_expiry_idx').on(table.expiresAt),
    check('oidc_login_attempts_expiry_check', sql`${table.expiresAt} >= 0`),
    check(
      'oidc_login_attempts_values_check',
      sql`length(${table.stateDigest}) >= 1
        AND (${table.cookieDigest} IS NULL OR length(${table.cookieDigest}) >= 1)
        AND length(${table.codeVerifier}) >= 1
        AND length(${table.nonce}) >= 1`,
    ),
  ],
);

export const operatorAuditEntries = sqliteTable(
  'operator_audit_entries',
  {
    id: text('id').primaryKey(),
    occurredAt: integer('occurred_at').notNull(),
    issuer: text('issuer'),
    subject: text('subject'),
    kind: text('kind', { enum: ADMIN_AUDIT_KINDS }).notNull(),
    outcome: text('outcome', { enum: ADMIN_AUDIT_OUTCOMES }).notNull(),
    reason: text('reason'),
  },
  (table) => [
    index('operator_audit_entries_occurred_idx').on(table.occurredAt, table.id),
    index('operator_audit_entries_identity_idx').on(
      table.issuer,
      table.subject,
      table.occurredAt,
    ),
    index('operator_audit_entries_kind_occurred_idx').on(
      table.kind,
      table.occurredAt,
      table.id,
    ),
    index('operator_audit_entries_outcome_occurred_idx').on(
      table.outcome,
      table.occurredAt,
      table.id,
    ),
    index('operator_audit_entries_kind_outcome_occurred_idx').on(
      table.kind,
      table.outcome,
      table.occurredAt,
      table.id,
    ),
    foreignKey({
      columns: [table.issuer, table.subject],
      foreignColumns: [operatorIdentities.issuer, operatorIdentities.subject],
      name: 'operator_audit_entries_identity_fk',
    }).onDelete('restrict'),
    check(
      'operator_audit_entries_identity_check',
      sql`(${table.issuer} IS NULL AND ${table.subject} IS NULL)
        OR (${table.issuer} IS NOT NULL AND ${table.subject} IS NOT NULL)`,
    ),
    check(
      'operator_audit_entries_kind_check',
      sql`${table.kind} IN ('login', 'logout', 'session_expired', 'session_revoked', 'session_cap_eviction', 'policy_rejected', 'session_purge', 'firebase_validation', 'cleanup', 'backup')`,
    ),
    check(
      'operator_audit_entries_outcome_check',
      sql`${table.outcome} IN ('succeeded', 'failed', 'started', 'outcome_unknown')`,
    ),
    check(
      'operator_audit_entries_reason_check',
      sql`${table.reason} IS NULL OR (
        length(${table.reason}) BETWEEN 1 AND 64
        AND substr(${table.reason}, 1, 1) GLOB '[a-z]'
        AND ${table.reason} NOT GLOB '*[^a-z0-9_]*'
      )`,
    ),
    check(
      'operator_audit_entries_values_check',
      sql`length(${table.id}) BETWEEN 16 AND 128 AND ${table.occurredAt} >= 0`,
    ),
  ],
);

export const operationLeases = sqliteTable(
  'operation_leases',
  {
    kind: text('kind', { enum: ADMIN_OPERATION_KINDS }).primaryKey(),
    leaseId: text('lease_id').notNull(),
    acquiredAt: integer('acquired_at').notNull(),
    leaseExpiresAt: integer('lease_expires_at').notNull(),
    cooldownEndsAt: integer('cooldown_ends_at').notNull(),
  },
  (table) => [
    uniqueIndex('operation_leases_lease_id_idx').on(table.leaseId),
    index('operation_leases_expiry_idx').on(
      table.leaseExpiresAt,
      table.cooldownEndsAt,
    ),
    check(
      'operation_leases_kind_check',
      sql`${table.kind} IN ('firebase_validation', 'cleanup', 'backup')`,
    ),
    check(
      'operation_leases_timestamps_check',
      sql`${table.acquiredAt} >= 0
        AND ${table.leaseExpiresAt} > ${table.acquiredAt}
        AND ${table.cooldownEndsAt} >= ${table.leaseExpiresAt}`,
    ),
    check(
      'operation_leases_values_check',
      sql`length(${table.leaseId}) BETWEEN 16 AND 128`,
    ),
  ],
);

export const operationResults = sqliteTable(
  'operation_results',
  {
    kind: text('kind', { enum: ADMIN_OPERATION_KINDS }).primaryKey(),
    leaseId: text('lease_id').notNull(),
    completedAt: integer('completed_at').notNull(),
    outcome: text('outcome', {
      enum: ['succeeded', 'failed', 'outcome_unknown'],
    }).notNull(),
    reason: text('reason'),
  },
  (table) => [
    foreignKey({
      columns: [table.kind],
      foreignColumns: [operationLeases.kind],
      name: 'operation_results_lease_fk',
    }).onDelete('cascade'),
    check(
      'operation_results_values_check',
      sql`${table.kind} IN ('firebase_validation', 'cleanup', 'backup')
        AND length(${table.leaseId}) BETWEEN 16 AND 128
        AND ${table.completedAt} >= 0
        AND ${table.outcome} IN ('succeeded', 'failed', 'outcome_unknown')
        AND (${table.reason} IS NULL OR (
          length(${table.reason}) BETWEEN 1 AND 64
          AND substr(${table.reason}, 1, 1) GLOB '[a-z]'
          AND ${table.reason} NOT GLOB '*[^a-z0-9_]*'
        ))`,
    ),
  ],
);

export const requestMetricsHourly = sqliteTable(
  'request_metrics_hourly',
  {
    hour: integer('hour').primaryKey(),
    processed: integer('processed').notNull().default(0),
    invalid: integer('invalid').notNull().default(0),
    rateLimited: integer('rate_limited').notNull().default(0),
    safetyBudgetExhausted: integer('safety_budget_exhausted')
      .notNull()
      .default(0),
    storageUnavailable: integer('storage_unavailable').notNull().default(0),
  },
  (table) => [
    check(
      'request_metrics_hourly_values_check',
      sql`${table.hour} >= 0 AND ${table.hour} % 3600 = 0
        AND ${table.processed} >= 0
        AND ${table.invalid} >= 0
        AND ${table.rateLimited} >= 0
        AND ${table.safetyBudgetExhausted} >= 0
        AND ${table.storageUnavailable} >= 0`,
    ),
  ],
);

export const fcmMetricsHourly = sqliteTable(
  'fcm_metrics_hourly',
  {
    hour: integer('hour').notNull(),
    platform: text('platform', { enum: DELIVERY_PLATFORMS }).notNull(),
    attempted: integer('attempted').notNull().default(0),
    accepted: integer('accepted').notNull().default(0),
    permanentlyRejected: integer('permanently_rejected').notNull().default(0),
    transientFailure: integer('transient_failure').notNull().default(0),
    latencyUnder100: integer('latency_under_100').notNull().default(0),
    latency100To249: integer('latency_100_to_249').notNull().default(0),
    latency250To499: integer('latency_250_to_499').notNull().default(0),
    latency500To999: integer('latency_500_to_999').notNull().default(0),
    latency1000To2499: integer('latency_1000_to_2499').notNull().default(0),
    latency2500To4999: integer('latency_2500_to_4999').notNull().default(0),
    latency5000To9999: integer('latency_5000_to_9999').notNull().default(0),
    latency10000OrMore: integer('latency_10000_or_more').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.hour, table.platform] }),
    check(
      'fcm_metrics_hourly_values_check',
      sql`${table.hour} >= 0 AND ${table.hour} % 3600 = 0
        AND ${table.platform} IN ('android', 'ios')
        AND ${table.attempted} >= 0
        AND ${table.accepted} >= 0
        AND ${table.permanentlyRejected} >= 0
        AND ${table.transientFailure} >= 0
        AND ${table.latencyUnder100} >= 0
        AND ${table.latency100To249} >= 0
        AND ${table.latency250To499} >= 0
        AND ${table.latency500To999} >= 0
        AND ${table.latency1000To2499} >= 0
        AND ${table.latency2500To4999} >= 0
        AND ${table.latency5000To9999} >= 0
        AND ${table.latency10000OrMore} >= 0`,
    ),
  ],
);

export const verifiedBackups = sqliteTable(
  'verified_backups',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    issuer: text('issuer'),
    subject: text('subject'),
  },
  (table) => [
    uniqueIndex('verified_backups_name_idx').on(table.name),
    index('verified_backups_created_idx').on(table.createdAt, table.id),
    foreignKey({
      columns: [table.issuer, table.subject],
      foreignColumns: [operatorIdentities.issuer, operatorIdentities.subject],
      name: 'verified_backups_identity_fk',
    }).onDelete('restrict'),
    check(
      'verified_backups_values_check',
      sql`length(${table.id}) BETWEEN 16 AND 128
        AND length(${table.name}) BETWEEN 1 AND 128
        AND ${table.name} NOT LIKE '%/%'
        AND ${table.name} NOT LIKE '%\\%'
        AND ${table.createdAt} >= 0
        AND ${table.sizeBytes} > 0
        AND length(${table.sha256}) = 64
        AND lower(${table.sha256}) = ${table.sha256}
        AND ${table.sha256} NOT GLOB '*[^a-f0-9]*'
        AND ((${table.issuer} IS NULL AND ${table.subject} IS NULL)
          OR (${table.issuer} IS NOT NULL AND ${table.subject} IS NOT NULL))`,
    ),
  ],
);

export const adminSchema = {
  fcmMetricsHourly,
  oidcLoginAttempts,
  operationLeases,
  operationResults,
  operatorAuditEntries,
  operatorIdentities,
  operatorSessions,
  requestMetricsHourly,
  verifiedBackups,
};

export type AdminSchema = typeof adminSchema;
