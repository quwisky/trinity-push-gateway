/**
 * Generated from apps/push-gateway/src/admin-contract/overview-metrics.ts.
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
