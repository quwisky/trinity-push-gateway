import * as z from 'zod/mini';

import {
  ADMIN_CONTRACT_REGISTRY,
  boundedSafeCountSum,
  SAFE_COUNT_SCHEMA,
  UTC_TIMESTAMP_SCHEMA,
} from './shared';
import { OPERATION_SUMMARY_REASON_SCHEMA } from './operator-actions';

const SECONDS_PER_HOUR = 60 * 60;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const METRICS_MAXIMUM_RANGE_DAYS = 30;

export const METRICS_QUERY_POLICY = Object.freeze({
  defaultInterval: 'hour' as const,
  defaultRangeSeconds: SECONDS_PER_DAY,
  intervalSeconds: Object.freeze({
    day: SECONDS_PER_DAY,
    hour: SECONDS_PER_HOUR,
  }),
  intervals: ['hour', 'day'] as const,
  maximumRangeDays: METRICS_MAXIMUM_RANGE_DAYS,
  maximumRangeSeconds: METRICS_MAXIMUM_RANGE_DAYS * SECONDS_PER_DAY,
});

const timestampRangeIsValid = (
  from: string,
  to: string,
  maximumSeconds?: number,
): boolean => {
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  return (
    Number.isFinite(fromMs) &&
    Number.isFinite(toMs) &&
    fromMs >= 0 &&
    toMs > fromMs &&
    (maximumSeconds === undefined || toMs - fromMs <= maximumSeconds * 1_000)
  );
};

export const boundedFcmAttempted = ({
  accepted,
  permanentlyRejected,
  transientFailure,
}: Readonly<{
  accepted: number;
  permanentlyRejected: number;
  transientFailure: number;
}>): number =>
  boundedSafeCountSum(accepted, permanentlyRejected, transientFailure);

const REQUEST_OUTCOME_COUNTS_SCHEMA = z
  .strictObject({
    processed: SAFE_COUNT_SCHEMA,
    invalid: SAFE_COUNT_SCHEMA,
    rateLimited: SAFE_COUNT_SCHEMA,
    safetyBudgetExhausted: SAFE_COUNT_SCHEMA,
    storageUnavailable: SAFE_COUNT_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Mutually exclusive Notification Request outcomes. Counts contain no request, Matrix, Push Key, Account Route, or Client Installation labels.',
    id: 'RequestOutcomeCounts',
  });

const FCM_OUTCOME_COUNTS_SCHEMA = z
  .strictObject({
    attempted: SAFE_COUNT_SCHEMA,
    accepted: SAFE_COUNT_SCHEMA,
    permanentlyRejected: SAFE_COUNT_SCHEMA,
    transientFailure: SAFE_COUNT_SCHEMA,
  })
  .check(
    z.refine(
      (outcomes) => outcomes.attempted === boundedFcmAttempted(outcomes),
    ),
  )
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Outcomes for actual FCM network calls only. `attempted` equals the bounded sum of the three mutually exclusive outcomes. `accepted` means accepted by FCM, not delivered to a Client Installation.',
    id: 'FcmOutcomeCounts',
  });

const FCM_PLATFORM_TOTALS_SCHEMA = z
  .strictObject({
    android: FCM_OUTCOME_COUNTS_SCHEMA,
    ios: FCM_OUTCOME_COUNTS_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'FcmPlatformTotals' });

const OPERATION_SUMMARY_OUTCOME_SCHEMA = z
  .enum(['succeeded', 'failed', 'outcome_unknown'])
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'OperationSummaryOutcome' });

const OPERATION_SUMMARY_SCHEMA = z
  .strictObject({
    startedAt: UTC_TIMESTAMP_SCHEMA,
    completedAt: UTC_TIMESTAMP_SCHEMA,
    outcome: OPERATION_SUMMARY_OUTCOME_SCHEMA,
    cooldownEndsAt: UTC_TIMESTAMP_SCHEMA,
    reason: z.optional(OPERATION_SUMMARY_REASON_SCHEMA),
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'OperationSummary' });

const DATABASE_BYTE_USAGE_SCHEMA = z
  .strictObject({
    gateway: SAFE_COUNT_SCHEMA,
    administration: SAFE_COUNT_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Current database file usage in bytes; no paths or filesystem details.',
    id: 'DatabaseByteUsage',
  });

export const OVERVIEW_RESPONSE_SCHEMA = z
  .strictObject({
    observedAt: UTC_TIMESTAMP_SCHEMA,
    version: z
      .string()
      .check(z.minLength(1), z.maxLength(128))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description: 'Running Push Gateway release version.',
      }),
    uptimeSeconds: SAFE_COUNT_SCHEMA,
    gatewayReady: z.boolean().register(ADMIN_CONTRACT_REGISTRY, {
      description:
        'Delivery readiness last observed by the independent runtime during public health or delivery storage work. The overview does not probe gateway.sqlite.',
    }),
    administrationReady: z.boolean().register(ADMIN_CONTRACT_REGISTRY, {
      description:
        'Whether the current authenticated request reached the isolated administration subsystem successfully.',
    }),
    requestsLast24Hours: REQUEST_OUTCOME_COUNTS_SCHEMA,
    fcmAttemptsLast24Hours: FCM_PLATFORM_TOTALS_SCHEMA,
    lastCleanup: z.optional(OPERATION_SUMMARY_SCHEMA),
    lastBackup: z.optional(OPERATION_SUMMARY_SCHEMA),
    lastFirebaseValidation: z.optional(OPERATION_SUMMARY_SCHEMA),
    databaseBytes: DATABASE_BYTE_USAGE_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'Overview' });

export type OverviewResponse = z.infer<typeof OVERVIEW_RESPONSE_SCHEMA>;

export const METRICS_INTERVAL_SCHEMA = z
  .enum(METRICS_QUERY_POLICY.intervals)
  .register(ADMIN_CONTRACT_REGISTRY, {
    default: METRICS_QUERY_POLICY.defaultInterval,
    id: 'MetricsInterval',
  });

export type MetricsInterval = z.infer<typeof METRICS_INTERVAL_SCHEMA>;

const REQUEST_METRIC_BUCKET_SCHEMA = z
  .strictObject({
    from: UTC_TIMESTAMP_SCHEMA,
    to: UTC_TIMESTAMP_SCHEMA,
    outcomes: REQUEST_OUTCOME_COUNTS_SCHEMA,
  })
  .check(z.refine(({ from, to }) => timestampRangeIsValid(from, to)))
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'RequestMetricBucket' });

const FCM_PLATFORM_SCHEMA = z
  .enum(['android', 'ios'])
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'FcmPlatform' });

const FCM_LATENCY_HISTOGRAM_SCHEMA = z
  .strictObject({
    under_100_ms: SAFE_COUNT_SCHEMA,
    '100_to_249_ms': SAFE_COUNT_SCHEMA,
    '250_to_499_ms': SAFE_COUNT_SCHEMA,
    '500_to_999_ms': SAFE_COUNT_SCHEMA,
    '1000_to_2499_ms': SAFE_COUNT_SCHEMA,
    '2500_to_4999_ms': SAFE_COUNT_SCHEMA,
    '5000_to_9999_ms': SAFE_COUNT_SCHEMA,
    '10000_ms_or_more': SAFE_COUNT_SCHEMA,
  })
  .register(ADMIN_CONTRACT_REGISTRY, {
    description: 'Fixed non-cumulative latency buckets for actual FCM calls.',
    id: 'FcmLatencyHistogram',
  });

const FCM_LATENCY_METRICS_SCHEMA = z
  .strictObject({
    sampleCount: SAFE_COUNT_SCHEMA,
    histogram: FCM_LATENCY_HISTOGRAM_SCHEMA,
    approxP95Ms: z
      .nullable(z.number().check(z.int(), z.gte(0), z.lte(10_000)))
      .register(ADMIN_CONTRACT_REGISTRY, {
        description:
          'Approximate p95 using the upper bound of the first histogram bucket reaching 95 percent. `10000` represents the open-ended final bucket; `null` means there were no samples.',
      }),
  })
  .check(
    z.refine(({ approxP95Ms, histogram, sampleCount }) => {
      const histogramSamples = boundedSafeCountSum(...Object.values(histogram));
      return (
        sampleCount === histogramSamples &&
        (sampleCount === 0) === (approxP95Ms === null)
      );
    }),
  )
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Approximate latency derived only from fixed histogram buckets. No raw samples, per-request timings, arbitrary labels, or sums are returned.',
    id: 'FcmLatencyMetrics',
  });

const FCM_METRIC_BUCKET_SCHEMA = z
  .strictObject({
    from: UTC_TIMESTAMP_SCHEMA,
    to: UTC_TIMESTAMP_SCHEMA,
    platform: FCM_PLATFORM_SCHEMA,
    outcomes: FCM_OUTCOME_COUNTS_SCHEMA,
    latency: FCM_LATENCY_METRICS_SCHEMA,
  })
  .check(z.refine(({ from, to }) => timestampRangeIsValid(from, to)))
  .register(ADMIN_CONTRACT_REGISTRY, { id: 'FcmMetricBucket' });

export const METRICS_RESPONSE_SCHEMA = z
  .strictObject({
    from: UTC_TIMESTAMP_SCHEMA,
    to: UTC_TIMESTAMP_SCHEMA,
    interval: METRICS_INTERVAL_SCHEMA,
    requestBuckets: z
      .array(REQUEST_METRIC_BUCKET_SCHEMA)
      .check(z.maxLength(720)),
    fcmBuckets: z.array(FCM_METRIC_BUCKET_SCHEMA).check(z.maxLength(1_440)),
  })
  .check(
    z.refine(({ from, to }) =>
      timestampRangeIsValid(from, to, METRICS_QUERY_POLICY.maximumRangeSeconds),
    ),
  )
  .register(ADMIN_CONTRACT_REGISTRY, {
    description:
      'Aggregate UTC buckets covering the effective `[from,to)` range. Empty intervals may be omitted; all labels and outcomes are fixed by this schema.',
    id: 'Metrics',
  });

export type MetricsResponse = z.infer<typeof METRICS_RESPONSE_SCHEMA>;

export {
  OPERATION_SUMMARY_REASON_SCHEMA,
  type OperationSummaryReason,
} from './operator-actions';

const METRICS_QUERY_SCHEMA = z
  .strictObject({
    from: z.optional(UTC_TIMESTAMP_SCHEMA),
    to: z.optional(UTC_TIMESTAMP_SCHEMA),
    interval: z.optional(METRICS_INTERVAL_SCHEMA),
  })
  .check(
    z.refine(
      ({ from, to }) =>
        (from === undefined && to === undefined) ||
        (from !== undefined &&
          to !== undefined &&
          timestampRangeIsValid(
            from,
            to,
            METRICS_QUERY_POLICY.maximumRangeSeconds,
          )),
    ),
  );

export type EffectiveMetricsRange = Readonly<{
  from: number;
  interval: MetricsInterval;
  to: number;
}>;

export function parseMetricsRange(
  searchParameters: URLSearchParams,
  nowSeconds: number,
): EffectiveMetricsRange | undefined {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return undefined;

  const entries = [...searchParameters.entries()];
  for (const [key] of entries) {
    if (searchParameters.getAll(key).length !== 1) return undefined;
  }
  const parsed = METRICS_QUERY_SCHEMA.safeParse(Object.fromEntries(entries));
  if (!parsed.success) return undefined;

  const to =
    parsed.data.to === undefined
      ? nowSeconds
      : Math.floor(Date.parse(parsed.data.to) / 1_000);
  const from =
    parsed.data.from === undefined
      ? to - METRICS_QUERY_POLICY.defaultRangeSeconds
      : Math.floor(Date.parse(parsed.data.from) / 1_000);
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to - from > METRICS_QUERY_POLICY.maximumRangeSeconds
  ) {
    return undefined;
  }
  return {
    from,
    interval: parsed.data.interval ?? METRICS_QUERY_POLICY.defaultInterval,
    to,
  };
}
