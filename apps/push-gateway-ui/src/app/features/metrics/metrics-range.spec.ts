import { includesCurrentUtcBucket } from './metrics-range';

describe('includesCurrentUtcBucket', () => {
  const now = new Date('2026-08-31T07:30:00Z').getTime();

  it('includes ranges that overlap the current UTC hour or day', () => {
    expect(
      includesCurrentUtcBucket(
        {
          from: '2026-08-31T06:00:00Z',
          to: '2026-08-31T08:00:00Z',
          interval: 'hour',
        },
        now,
      ),
    ).toBe(true);
    expect(
      includesCurrentUtcBucket(
        {
          from: '2026-08-31T00:00:00Z',
          to: '2026-09-01T00:00:00Z',
          interval: 'day',
        },
        now,
      ),
    ).toBe(true);
  });

  it('rejects past, future, and invalid ranges', () => {
    expect(
      includesCurrentUtcBucket(
        {
          from: '2026-08-30T00:00:00Z',
          to: '2026-08-31T07:00:00Z',
          interval: 'hour',
        },
        now,
      ),
    ).toBe(false);
    expect(
      includesCurrentUtcBucket(
        {
          from: '2026-08-31T08:00:00Z',
          to: '2026-08-31T09:00:00Z',
          interval: 'hour',
        },
        now,
      ),
    ).toBe(false);
    expect(
      includesCurrentUtcBucket(
        { from: 'invalid', to: 'invalid', interval: 'hour' },
        now,
      ),
    ).toBe(false);
  });

  it('treats omitted API bounds as an open range', () => {
    expect(includesCurrentUtcBucket({ interval: 'hour' }, now)).toBe(true);
  });
});
