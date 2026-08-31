import { describe, expect, it } from 'bun:test';

import {
  METRICS_RESPONSE_SCHEMA,
  OVERVIEW_RESPONSE_SCHEMA,
  parseMetricsRange,
} from '../../../src/admin-contract/overview-metrics';
import {
  LEGACY_ADMIN_METRICS_SCHEMA,
  LEGACY_ADMIN_OVERVIEW_SCHEMA,
} from '../../../src/bun/admin/contract';
import {
  INVALID_METRICS_FIXTURES,
  INVALID_OVERVIEW_FIXTURES,
  MINIMAL_METRICS_RESPONSE,
  VALID_METRICS_FIXTURES,
  VALID_OVERVIEW_FIXTURES,
} from './support/overview-metrics-contract-fixtures';

describe('Overview and metrics response contract', () => {
  it('keeps canonical and migration Overview validators compatible', () => {
    for (const fixture of VALID_OVERVIEW_FIXTURES) {
      expect(
        OVERVIEW_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator rejected ${fixture.name}`,
      ).toBe(true);
      expect(
        LEGACY_ADMIN_OVERVIEW_SCHEMA.safeParse(fixture.value).success,
        `migration validator rejected ${fixture.name}`,
      ).toBe(true);
    }
    for (const fixture of INVALID_OVERVIEW_FIXTURES) {
      expect(
        OVERVIEW_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator accepted ${fixture.name}`,
      ).toBe(false);
      expect(
        LEGACY_ADMIN_OVERVIEW_SCHEMA.safeParse(fixture.value).success,
        `migration validator accepted ${fixture.name}`,
      ).toBe(false);
    }
  });

  it('keeps canonical and migration Metrics validators compatible', () => {
    for (const fixture of VALID_METRICS_FIXTURES) {
      expect(
        METRICS_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator rejected ${fixture.name}`,
      ).toBe(true);
      expect(
        LEGACY_ADMIN_METRICS_SCHEMA.safeParse(fixture.value).success,
        `migration validator rejected ${fixture.name}`,
      ).toBe(true);
    }
    for (const fixture of INVALID_METRICS_FIXTURES) {
      expect(
        METRICS_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator accepted ${fixture.name}`,
      ).toBe(false);
      expect(
        LEGACY_ADMIN_METRICS_SCHEMA.safeParse(fixture.value).success,
        `migration validator accepted ${fixture.name}`,
      ).toBe(false);
    }
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
