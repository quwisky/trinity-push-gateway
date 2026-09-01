import * as z from 'zod/mini';

import {
  METRICS_QUERY_POLICY,
  METRICS_RESPONSE_SCHEMA,
  OVERVIEW_RESPONSE_SCHEMA,
} from './overview-metrics';
import { adminContractOpenApiComponents, type JsonValue } from './openapi';

const OVERVIEW_METRICS_RESPONSES_SCHEMA = z.strictObject({
  overview: OVERVIEW_RESPONSE_SCHEMA,
  metrics: METRICS_RESPONSE_SCHEMA,
});

const COMPONENT_ORDER = [
  'SafeCount',
  'RequestOutcomeCounts',
  'FcmOutcomeCounts',
  'FcmPlatformTotals',
  'OperationSummaryOutcome',
  'OperationSummary',
  'DatabaseByteUsage',
  'Overview',
  'MetricsInterval',
  'RequestMetricBucket',
  'FcmPlatform',
  'FcmLatencyHistogram',
  'FcmLatencyMetrics',
  'FcmMetricBucket',
  'Metrics',
] as const;

export function overviewMetricsOpenApiComponents(): Readonly<
  Record<(typeof COMPONENT_ORDER)[number], JsonValue>
> {
  return adminContractOpenApiComponents(
    OVERVIEW_METRICS_RESPONSES_SCHEMA,
    COMPONENT_ORDER,
    ['UtcTimestamp', 'OperationSummaryReason'],
  );
}

const maximumRangeDescription = `The maximum range is ${String(METRICS_QUERY_POLICY.maximumRangeDays)} days.`;

export function metricsOpenApiParameters(): Readonly<
  Record<'MetricsFrom' | 'MetricsInterval' | 'MetricsTo', JsonValue>
> {
  return {
    MetricsFrom: {
      name: 'from',
      in: 'query',
      required: false,
      description: `Inclusive UTC start of the metrics range. \`from\` and \`to\` must either both be omitted or both be supplied. ${maximumRangeDescription}`,
      schema: { $ref: '#/components/schemas/UtcTimestamp' },
    },
    MetricsTo: {
      name: 'to',
      in: 'query',
      required: false,
      description: `Exclusive UTC end of the metrics range. \`from\` and \`to\` must either both be omitted or both be supplied. ${maximumRangeDescription}`,
      schema: { $ref: '#/components/schemas/UtcTimestamp' },
    },
    MetricsInterval: {
      name: 'interval',
      in: 'query',
      required: false,
      description: 'UTC aggregation interval. Defaults to `hour`.',
      schema: { $ref: '#/components/schemas/MetricsInterval' },
    },
  };
}
