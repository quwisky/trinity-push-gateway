export const REQUEST_METRIC_OUTCOMES = [
  'processed',
  'invalid',
  'rateLimited',
  'safetyBudgetExhausted',
  'storageUnavailable',
] as const;

export const FCM_METRIC_OUTCOMES = [
  'accepted',
  'permanentlyRejected',
  'transientFailure',
] as const;

export type RequestMetricOutcome = (typeof REQUEST_METRIC_OUTCOMES)[number];
export type FcmMetricOutcome = (typeof FCM_METRIC_OUTCOMES)[number];
export type MetricPlatform = 'android' | 'ios';

export type GatewayMetricsSink = Readonly<{
  recordFcmAttempt(
    platform: MetricPlatform,
    outcome: FcmMetricOutcome,
    latencyMs: number,
    occurredAtMs: number,
  ): void;
  recordRequest(outcome: RequestMetricOutcome, occurredAtMs: number): void;
}>;

export type RequestMetricRow = Readonly<{
  hour: number;
  invalid: number;
  processed: number;
  rateLimited: number;
  safetyBudgetExhausted: number;
  storageUnavailable: number;
}>;

export type FcmMetricRow = Readonly<{
  accepted: number;
  attempted: number;
  hour: number;
  latency1000To2499: number;
  latency10000OrMore: number;
  latency100To249: number;
  latency2500To4999: number;
  latency250To499: number;
  latency5000To9999: number;
  latency500To999: number;
  latencyUnder100: number;
  permanentlyRejected: number;
  platform: MetricPlatform;
  transientFailure: number;
}>;

export type MetricsBatch = Readonly<{
  fcm: readonly FcmMetricRow[];
  requests: readonly RequestMetricRow[];
}>;

export function utcHourSeconds(occurredAtMs: number): number {
  return Math.floor(occurredAtMs / 3_600_000) * 3_600;
}
