import * as z from 'zod/mini';

import { OPERATOR_IDENTITY_SCHEMA } from './operator-session';
import {
  ADMIN_CONTRACT_REGISTRY,
  OPAQUE_ID_SCHEMA,
  POSITIVE_SAFE_INTEGER_SCHEMA,
  UTC_TIMESTAMP_SCHEMA,
} from './shared';

const SECONDS_PER_DAY = 24 * 60 * 60;

export const AUDIT_QUERY_POLICY = Object.freeze({
  cursorLifetimeSeconds: 15 * 60,
  defaultPageSize: 50,
  defaultRangeSeconds: SECONDS_PER_DAY,
  maximumCursorLength: 2_048,
  maximumPageSize: 100,
  maximumRangeDays: 90,
  maximumRangeSeconds: 90 * SECONDS_PER_DAY,
});

export const AUDIT_ENTRY_KINDS = [
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

export const AUDIT_ENTRY_OUTCOMES = [
  'succeeded',
  'failed',
  'started',
  'outcome_unknown',
] as const;

export const OPERATOR_ACTION_KINDS = [
  'firebase_validation',
  'cleanup',
  'backup',
] as const;

export const OPERATION_SUMMARY_REASONS = [
  'access_denied',
  'audit_finalization_failed',
  'backup_failed',
  'backup_limit_exceeded',
  'cleanup_failed',
  'firebase_validation_failed',
  'operation_timeout',
  'request_rejected',
  'unavailable',
] as const;

export const OPERATION_SUMMARY_REASON_SCHEMA = z
  .enum(OPERATION_SUMMARY_REASONS)
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Finite privacy-safe reason for an administration operation summary or known Operator Action result.',
    id: 'OperationSummaryReason',
  });

export type OperationSummaryReason = z.infer<
  typeof OPERATION_SUMMARY_REASON_SCHEMA
>;

const OPERATION_RESULT_OUTCOME_SCHEMA = z
  .enum(['succeeded', 'failed'])
  .register(ADMIN_CONTRACT_REGISTRY, {
    description: 'Known result of the synchronous Operator Action.',
    id: 'OperationResultOutcome',
  });

export const OPERATION_RESULT_SCHEMA = z
  .strictObject({
    startedAt: UTC_TIMESTAMP_SCHEMA,
    completedAt: UTC_TIMESTAMP_SCHEMA,
    outcome: OPERATION_RESULT_OUTCOME_SCHEMA,
    cooldownEndsAt: UTC_TIMESTAMP_SCHEMA,
    reason: z.optional(OPERATION_SUMMARY_REASON_SCHEMA),
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Known success or failure result of a bounded synchronous Operator Action.',
    id: 'OperationResult',
  });

export type OperationResult = z.infer<typeof OPERATION_RESULT_SCHEMA>;

export const AUDIT_ENTRY_KIND_SCHEMA = z
  .enum(AUDIT_ENTRY_KINDS)
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'AuditEntryKind' });

export const AUDIT_ENTRY_OUTCOME_SCHEMA = z
  .enum(AUDIT_ENTRY_OUTCOMES)
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'AuditEntryOutcome' });

const OPERATOR_SESSION_AUDIT_REASONS = [
  'absolute_expired',
  'idle_expired',
  'no_active_sessions',
  'policy_changed',
  'session_cap',
] as const;

export const AUDIT_ENTRY_REASONS = [
  ...OPERATION_SUMMARY_REASONS,
  ...OPERATOR_SESSION_AUDIT_REASONS,
] as const;

export const AUDIT_ENTRY_REASON_SCHEMA = z
  .enum(AUDIT_ENTRY_REASONS)
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Finite privacy-safe reason for an Operator Audit Entry; raw claims, identifiers, external errors, and process errors are excluded.',
    id: 'AuditEntryReason',
  });

export type AuditEntryReason = z.infer<typeof AUDIT_ENTRY_REASON_SCHEMA>;

const OPERATOR_AUDIT_ENTRY_SCHEMA = z
  .strictObject({
    id: OPAQUE_ID_SCHEMA,
    occurredAt: UTC_TIMESTAMP_SCHEMA,
    operator: z
      .nullable(OPERATOR_IDENTITY_SCHEMA)
      .register(ADMIN_CONTRACT_REGISTRY, {
        description:
          'Responsible Operator Identity, or `null` for a system or CLI occurrence.',
      }),
    kind: AUDIT_ENTRY_KIND_SCHEMA,
    outcome: AUDIT_ENTRY_OUTCOME_SCHEMA,
    reason: z.optional(AUDIT_ENTRY_REASON_SCHEMA),
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'OperatorAuditEntry' });

export const OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA = z
  .strictObject({
    entries: z
      .array(OPERATOR_AUDIT_ENTRY_SCHEMA)
      .check(z.maxLength(AUDIT_QUERY_POLICY.maximumPageSize)),
    nextCursor: z.optional(
      z
        .string()
        .check(
          z.minLength(1),
          z.maxLength(AUDIT_QUERY_POLICY.maximumCursorLength),
        )
        .register(ADMIN_CONTRACT_REGISTRY, {
          description:
            'Opaque continuation cursor; absent when no later page exists.',
        }),
    ),
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'OperatorAuditEntryPage' });

export type OperatorAuditEntryPage = z.infer<
  typeof OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA
>;

const BACKUP_INTEGRITY_SCHEMA = z
  .literal('verified')
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'BackupIntegrity' });

export const BACKUP_SCHEMA = z
  .strictObject({
    id: OPAQUE_ID_SCHEMA,
    name: z
      .string()
      .check(z.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Strict generated basename only; never a filesystem path.',
      }),
    createdAt: UTC_TIMESTAMP_SCHEMA,
    sizeBytes: POSITIVE_SAFE_INTEGER_SCHEMA,
    sha256: z
      .string()
      .check(z.regex(/^[a-f0-9]{64}$/u))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description:
          'Lowercase hexadecimal SHA-256 digest of the verified backup.',
      }),
    integrity: BACKUP_INTEGRITY_SCHEMA,
    operator: z
      .nullable(OPERATOR_IDENTITY_SCHEMA)
      .register(ADMIN_CONTRACT_REGISTRY, {
        description:
          'Requesting Operator Identity, or `null` for a CLI-created backup.',
      }),
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'Backup' });

export type Backup = z.infer<typeof BACKUP_SCHEMA>;

export const BACKUP_LIST_SCHEMA = z
  .strictObject({
    backups: z
      .array(BACKUP_SCHEMA)
      .check(z.maxLength(1_000))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Verified backup metadata ordered newest first.',
      }),
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'BackupList' });

export type BackupList = z.infer<typeof BACKUP_LIST_SCHEMA>;

export const ADMIN_PROBLEM_CATALOG = Object.freeze({
  unauthenticated: {
    status: 401,
    title: 'Authentication required',
  },
  forbidden: { status: 403, title: 'Forbidden' },
  invalid_request: { status: 400, title: 'Invalid request' },
  csrf_failed: { status: 403, title: 'Request validation failed' },
  operation_in_progress: {
    status: 409,
    title: 'Operation already in progress',
  },
  cooldown_active: { status: 429, title: 'Operation cooldown active' },
  operation_timeout: { status: 504, title: 'Operation timed out' },
  outcome_unknown: { status: 500, title: 'Operation outcome unknown' },
  backup_limit_exceeded: { status: 507, title: 'Backup limit exceeded' },
  admin_unavailable: { status: 503, title: 'Administration unavailable' },
  not_found: { status: 404, title: 'Not found' },
} as const);

export type AdminProblemCode = keyof typeof ADMIN_PROBLEM_CATALOG;

export const ADMIN_PROBLEM_CODES = Object.freeze(
  Object.keys(ADMIN_PROBLEM_CATALOG) as AdminProblemCode[],
);

const PROBLEM_DETAIL_SCHEMA = z
  .string()
  .check(z.minLength(1), z.maxLength(512))
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Generic safe explanation. It never includes secret values, tokens, identifiers, paths, external response bodies, or raw process errors.',
  });

const PROBLEM_INSTANCE_SCHEMA = z
  .string()
  .check(z.maxLength(2048))
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Optional request-local problem URI containing no private identifier.',
    format: 'uri-reference',
  });

// The inferred schema type retains the catalog literals used by the generated contract.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const problemVariantSchema = <Code extends AdminProblemCode>(code: Code) => {
  const definition = ADMIN_PROBLEM_CATALOG[code];
  return z.strictObject({
    type: z.literal(`/admin/problems/${code}`),
    title: z.literal(definition.title),
    status: z.literal(definition.status),
    code: z.literal(code),
    detail: z.optional(PROBLEM_DETAIL_SCHEMA),
    instance: z.optional(PROBLEM_INSTANCE_SCHEMA),
  });
};

export const ADMIN_PROBLEM_SCHEMA = z
  .union([
    problemVariantSchema('unauthenticated'),
    problemVariantSchema('forbidden'),
    problemVariantSchema('invalid_request'),
    problemVariantSchema('csrf_failed'),
    problemVariantSchema('operation_in_progress'),
    problemVariantSchema('cooldown_active'),
    problemVariantSchema('operation_timeout'),
    problemVariantSchema('outcome_unknown'),
    problemVariantSchema('backup_limit_exceeded'),
    problemVariantSchema('admin_unavailable'),
    problemVariantSchema('not_found'),
  ])
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'RFC 9457-style problem details constrained to the exact stable code, status, title, and type catalog.',
    id: 'Problem',
  });

export type AdminProblem = z.infer<typeof ADMIN_PROBLEM_SCHEMA>;

export function adminProblem(code: AdminProblemCode): AdminProblem {
  const definition = ADMIN_PROBLEM_CATALOG[code];
  return ADMIN_PROBLEM_SCHEMA.parse({
    code,
    status: definition.status,
    title: definition.title,
    type: `/admin/problems/${code}`,
  });
}
