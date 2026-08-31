/**
 * Generated from apps/push-gateway/src/admin-contract/overview-metrics.ts
 * and apps/push-gateway/src/admin-contract/operator-actions.ts.
 * Do not edit manually. Run pnpm nx run push-gateway:generate-admin-contract.
 */
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

export const ADMIN_PROBLEM_CODES = [
  'unauthenticated',
  'forbidden',
  'invalid_request',
  'csrf_failed',
  'operation_in_progress',
  'cooldown_active',
  'operation_timeout',
  'outcome_unknown',
  'backup_limit_exceeded',
  'admin_unavailable',
  'not_found',
] as const;
