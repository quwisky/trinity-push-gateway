/**
 * Generated from apps/push-gateway/src/admin-contract/overview-metrics.ts
 * and apps/push-gateway/src/admin-contract/operator-actions.ts.
 * Do not edit manually. Run pnpm nx run push-gateway:generate-admin-contract.
 */
import {
  literal,
  maxLength,
  minLength,
  optional,
  strictObject,
  string,
  union,
} from 'zod/mini';

export const METRICS_QUERY_POLICY = {
  defaultInterval: 'hour',
  defaultRangeSeconds: 86400,
  intervalSeconds: {
    day: 86400,
    hour: 3600,
  },
  intervals: ['hour', 'day'],
  maximumRangeDays: 30,
  maximumRangeSeconds: 2592000,
} as const;

export const AUDIT_QUERY_POLICY = {
  defaultPageSize: 50,
  defaultRangeSeconds: 86400,
  kinds: [
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
  ],
  maximumPageSize: 100,
  maximumRangeDays: 90,
  maximumRangeSeconds: 7776000,
  outcomes: ['succeeded', 'failed', 'started', 'outcome_unknown'],
} as const;

export const ADMIN_PROBLEM_CATALOG = {
  unauthenticated: {
    status: 401,
    title: 'Authentication required',
    type: '/admin/problems/unauthenticated',
  },
  forbidden: {
    status: 403,
    title: 'Forbidden',
    type: '/admin/problems/forbidden',
  },
  invalid_request: {
    status: 400,
    title: 'Invalid request',
    type: '/admin/problems/invalid_request',
  },
  csrf_failed: {
    status: 403,
    title: 'Request validation failed',
    type: '/admin/problems/csrf_failed',
  },
  operation_in_progress: {
    status: 409,
    title: 'Operation already in progress',
    type: '/admin/problems/operation_in_progress',
  },
  cooldown_active: {
    status: 429,
    title: 'Operation cooldown active',
    type: '/admin/problems/cooldown_active',
  },
  operation_timeout: {
    status: 504,
    title: 'Operation timed out',
    type: '/admin/problems/operation_timeout',
  },
  outcome_unknown: {
    status: 500,
    title: 'Operation outcome unknown',
    type: '/admin/problems/outcome_unknown',
  },
  backup_limit_exceeded: {
    status: 507,
    title: 'Backup limit exceeded',
    type: '/admin/problems/backup_limit_exceeded',
  },
  admin_unavailable: {
    status: 503,
    title: 'Administration unavailable',
    type: '/admin/problems/admin_unavailable',
  },
  not_found: {
    status: 404,
    title: 'Not found',
    type: '/admin/problems/not_found',
  },
} as const;

export const ADMIN_PROBLEM_FIELD_POLICY = {
  detail: {
    maximumLength: 512,
    minimumLength: 1,
  },
  instance: {
    maximumLength: 2048,
  },
} as const;

export type AdminProblemCode = keyof typeof ADMIN_PROBLEM_CATALOG;

// The inferred type retains the exact generated catalog literals.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const problemVariantSchema = <Code extends AdminProblemCode>(code: Code) => {
  const definition = ADMIN_PROBLEM_CATALOG[code];
  return strictObject({
    code: literal(code),
    detail: optional(
      string().check(
        minLength(ADMIN_PROBLEM_FIELD_POLICY.detail.minimumLength),
        maxLength(ADMIN_PROBLEM_FIELD_POLICY.detail.maximumLength),
      ),
    ),
    instance: optional(
      string().check(
        maxLength(ADMIN_PROBLEM_FIELD_POLICY.instance.maximumLength),
      ),
    ),
    status: literal(definition.status),
    title: literal(definition.title),
    type: literal(definition.type),
  });
};

export const ADMIN_PROBLEM_SCHEMA = union([
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
]);
