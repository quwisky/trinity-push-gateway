import { describe, expect, it } from 'bun:test';

import {
  metricsOpenApiParameters,
  overviewMetricsOpenApiComponents,
} from '../../../src/admin-contract/overview-metrics-openapi';

describe('Overview and metrics published contract', () => {
  it('projects strict fixed-cardinality response components', () => {
    const components = overviewMetricsOpenApiComponents();

    expect(Object.keys(components)).toEqual([
      'SafeCount',
      'RequestOutcomeCounts',
      'FcmOutcomeCounts',
      'FcmPlatformTotals',
      'OperationSummaryOutcome',
      'OperationSummaryReason',
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
    ]);
    expect(components).toMatchObject({
      SafeCount: {
        maximum: Number.MAX_SAFE_INTEGER,
        minimum: 0,
        type: 'integer',
      },
      RequestOutcomeCounts: {
        additionalProperties: false,
        properties: {
          processed: { $ref: '#/components/schemas/SafeCount' },
        },
      },
      FcmOutcomeCounts: {
        additionalProperties: false,
        required: [
          'attempted',
          'accepted',
          'permanentlyRejected',
          'transientFailure',
        ],
      },
      Overview: {
        additionalProperties: false,
        properties: {
          observedAt: { $ref: '#/components/schemas/UtcTimestamp' },
          requestsLast24Hours: {
            $ref: '#/components/schemas/RequestOutcomeCounts',
          },
        },
      },
      MetricsInterval: {
        default: 'hour',
        enum: ['hour', 'day'],
      },
      OperationSummaryReason: {
        enum: [
          'access_denied',
          'audit_finalization_failed',
          'backup_failed',
          'backup_limit_exceeded',
          'cleanup_failed',
          'firebase_validation_failed',
          'operation_timeout',
          'request_rejected',
          'unavailable',
        ],
      },
      FcmLatencyMetrics: {
        properties: {
          approxP95Ms: {
            maximum: 10_000,
            minimum: 0,
            type: ['integer', 'null'],
          },
        },
      },
      Metrics: {
        additionalProperties: false,
        properties: {
          fcmBuckets: { maxItems: 1_440 },
          requestBuckets: { maxItems: 720 },
        },
      },
    });
  });

  it('publishes the same metrics range and interval policy', () => {
    expect(metricsOpenApiParameters()).toEqual({
      MetricsFrom: {
        description:
          'Inclusive UTC start of the metrics range. `from` and `to` must either both be omitted or both be supplied. The maximum range is 30 days.',
        in: 'query',
        name: 'from',
        required: false,
        schema: { $ref: '#/components/schemas/UtcTimestamp' },
      },
      MetricsInterval: {
        description: 'UTC aggregation interval. Defaults to `hour`.',
        in: 'query',
        name: 'interval',
        required: false,
        schema: { $ref: '#/components/schemas/MetricsInterval' },
      },
      MetricsTo: {
        description:
          'Exclusive UTC end of the metrics range. `from` and `to` must either both be omitted or both be supplied. The maximum range is 30 days.',
        in: 'query',
        name: 'to',
        required: false,
        schema: { $ref: '#/components/schemas/UtcTimestamp' },
      },
    });
  });
});
