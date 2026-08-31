import {
  apiProblemSchema,
  auditFilterSchema,
  confirmationSchema,
  metricsFilterSchema,
} from './schemas';

describe('UI validation schemas', () => {
  it('accepts only bounded, ordered metrics ranges', () => {
    expect(
      metricsFilterSchema.safeParse({
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-02T00:00:00Z',
        interval: 'hour',
      }).success,
    ).toBe(true);
    expect(
      metricsFilterSchema.safeParse({
        from: '2026-08-02T00:00:00Z',
        to: '2026-08-01T00:00:00Z',
        interval: 'hour',
      }).success,
    ).toBe(false);
    expect(
      metricsFilterSchema.safeParse({
        from: '2026-06-01T00:00:00Z',
        to: '2026-08-01T00:00:00Z',
        interval: 'day',
      }).success,
    ).toBe(false);
  });

  it('validates audit filters and their finite 90-day range', () => {
    expect(
      auditFilterSchema.safeParse({
        from: '2026-08-01T00:00:00Z',
        to: '2026-08-31T00:00:00Z',
        kind: 'session_revoked',
        outcome: 'succeeded',
      }).success,
    ).toBe(true);
    expect(
      auditFilterSchema.safeParse({
        from: 'not-a-date',
        to: '2026-08-31T00:00:00Z',
        kind: 'all',
        outcome: 'all',
      }).success,
    ).toBe(false);
  });

  it('requires affirmative confirmation and safely shapes API problems', () => {
    expect(confirmationSchema.safeParse({ confirmed: true }).success).toBe(
      true,
    );
    expect(confirmationSchema.safeParse({ confirmed: false }).success).toBe(
      false,
    );
    expect(
      apiProblemSchema.safeParse({
        title: 'Unavailable',
        detail: 'Try again.',
        status: 503,
      }).success,
    ).toBe(true);
    expect(apiProblemSchema.safeParse({ title: 503 }).success).toBe(false);
  });
});
