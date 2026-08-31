import { describe, expect, it } from 'bun:test';

import {
  METRICS_RESPONSE_SCHEMA,
  OVERVIEW_RESPONSE_SCHEMA,
  parseMetricsRange,
} from '../../../src/admin-contract/overview-metrics';
import { expectContractFixtures } from './support/admin-contract-assertions';
import {
  INVALID_METRICS_FIXTURES,
  INVALID_OVERVIEW_FIXTURES,
  MINIMAL_METRICS_RESPONSE,
  VALID_METRICS_FIXTURES,
  VALID_OVERVIEW_FIXTURES,
} from './support/overview-metrics-contract-fixtures';

describe('Overview and metrics response contract', () => {
  it('keeps runtime and published Overview validation aligned', () => {
    expectContractFixtures(
      OVERVIEW_RESPONSE_SCHEMA,
      'Overview',
      VALID_OVERVIEW_FIXTURES,
      INVALID_OVERVIEW_FIXTURES,
    );
  });

  it('keeps runtime and published Metrics validation aligned', () => {
    expectContractFixtures(
      METRICS_RESPONSE_SCHEMA,
      'Metrics',
      VALID_METRICS_FIXTURES,
      INVALID_METRICS_FIXTURES,
    );
  });

  it('enforces fixed aggregate relationships at the canonical boundary', () => {
    const fcmBucket = MINIMAL_METRICS_RESPONSE.fcmBuckets[0];
    expect(fcmBucket).toBeDefined();

    expect(
      METRICS_RESPONSE_SCHEMA.safeParse({
        ...MINIMAL_METRICS_RESPONSE,
        fcmBuckets: [
          {
            ...fcmBucket,
            outcomes: { ...fcmBucket.outcomes, attempted: 2 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      METRICS_RESPONSE_SCHEMA.safeParse({
        ...MINIMAL_METRICS_RESPONSE,
        fcmBuckets: [
          {
            ...fcmBucket,
            latency: { ...fcmBucket.latency, sampleCount: 2 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      METRICS_RESPONSE_SCHEMA.safeParse({
        ...MINIMAL_METRICS_RESPONSE,
        from: MINIMAL_METRICS_RESPONSE.to,
        to: MINIMAL_METRICS_RESPONSE.from,
      }).success,
    ).toBe(false);
  });
});

describe('metrics range contract', () => {
  const nowSeconds = Date.parse('2026-08-31T18:00:00.000Z') / 1_000;

  it('owns the default and explicit bounded ranges', () => {
    expect(parseMetricsRange(new URLSearchParams(), nowSeconds)).toEqual({
      from: nowSeconds - 86_400,
      interval: 'hour',
      to: nowSeconds,
    });
    expect(
      parseMetricsRange(
        new URLSearchParams({
          from: '2026-08-01T00:00:00.000Z',
          interval: 'day',
          to: '2026-08-31T00:00:00.000Z',
        }),
        nowSeconds,
      ),
    ).toEqual({
      from: Date.parse('2026-08-01T00:00:00.000Z') / 1_000,
      interval: 'day',
      to: Date.parse('2026-08-31T00:00:00.000Z') / 1_000,
    });
  });

  it('rejects partial, excessive, duplicated, unknown, and non-UTC input', () => {
    const invalidQueries = [
      'from=2026-08-01T00%3A00%3A00.000Z',
      'from=2026-07-31T23%3A59%3A59.000Z&to=2026-08-31T00%3A00%3A00.000Z',
      'from=2026-08-01T00%3A00%3A00.000Z&from=2026-08-02T00%3A00%3A00.000Z&to=2026-08-31T00%3A00%3A00.000Z',
      'label=homeserver',
      '__proto__=homeserver',
      'interval=minute',
      'from=2026-08-01T02%3A00%3A00%2B02%3A00&to=2026-08-02T02%3A00%3A00%2B02%3A00',
    ];
    for (const query of invalidQueries) {
      expect(parseMetricsRange(new URLSearchParams(query), nowSeconds)).toBe(
        undefined,
      );
    }
  });
});
