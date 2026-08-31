export type OverviewMetricsContractFixture = Readonly<{
  name: string;
  value: unknown;
}>;

const ZERO_REQUEST_OUTCOMES = {
  invalid: 0,
  processed: 0,
  rateLimited: 0,
  safetyBudgetExhausted: 0,
  storageUnavailable: 0,
} as const;

const ZERO_FCM_OUTCOMES = {
  accepted: 0,
  attempted: 0,
  permanentlyRejected: 0,
  transientFailure: 0,
} as const;

export const MINIMAL_OVERVIEW_RESPONSE = {
  administrationReady: true,
  databaseBytes: { administration: 4096, gateway: 8192 },
  fcmAttemptsLast24Hours: {
    android: ZERO_FCM_OUTCOMES,
    ios: ZERO_FCM_OUTCOMES,
  },
  gatewayReady: true,
  observedAt: '2026-08-31T18:00:00.000Z',
  requestsLast24Hours: ZERO_REQUEST_OUTCOMES,
  uptimeSeconds: 60,
  version: '0.8.0-test',
} as const;

const REQUEST_BUCKET = {
  from: '2026-08-31T17:00:00.000Z',
  outcomes: {
    ...ZERO_REQUEST_OUTCOMES,
    processed: 2,
  },
  to: '2026-08-31T18:00:00.000Z',
} as const;

const FCM_BUCKET = {
  from: '2026-08-31T17:00:00.000Z',
  latency: {
    approxP95Ms: 100,
    histogram: {
      '10000_ms_or_more': 0,
      '1000_to_2499_ms': 0,
      '100_to_249_ms': 0,
      '2500_to_4999_ms': 0,
      '250_to_499_ms': 0,
      '5000_to_9999_ms': 0,
      '500_to_999_ms': 0,
      under_100_ms: 1,
    },
    sampleCount: 1,
  },
  outcomes: {
    accepted: 1,
    attempted: 1,
    permanentlyRejected: 0,
    transientFailure: 0,
  },
  platform: 'android',
  to: '2026-08-31T18:00:00.000Z',
} as const;

export const MINIMAL_METRICS_RESPONSE = {
  fcmBuckets: [FCM_BUCKET],
  from: '2026-08-31T17:00:00.000Z',
  interval: 'hour',
  requestBuckets: [REQUEST_BUCKET],
  to: '2026-08-31T18:00:00.000Z',
} as const;

export const VALID_OVERVIEW_FIXTURES: readonly OverviewMetricsContractFixture[] =
  [
    { name: 'minimal Overview', value: MINIMAL_OVERVIEW_RESPONSE },
    {
      name: 'Overview with bounded operation summaries',
      value: {
        ...MINIMAL_OVERVIEW_RESPONSE,
        lastBackup: {
          completedAt: '2026-08-31T17:55:10.000Z',
          cooldownEndsAt: '2026-08-31T18:55:10.000Z',
          outcome: 'failed',
          reason: 'backup_limit_exceeded',
          startedAt: '2026-08-31T17:55:00.000Z',
        },
      },
    },
  ];

export const INVALID_OVERVIEW_FIXTURES: readonly OverviewMetricsContractFixture[] =
  [
    {
      name: 'negative request count',
      value: {
        ...MINIMAL_OVERVIEW_RESPONSE,
        requestsLast24Hours: {
          ...ZERO_REQUEST_OUTCOMES,
          invalid: -1,
        },
      },
    },
    {
      name: 'arbitrary metric label',
      value: {
        ...MINIMAL_OVERVIEW_RESPONSE,
        requestsLast24Hours: {
          ...ZERO_REQUEST_OUTCOMES,
          homeserver: 1,
        },
      },
    },
    {
      name: 'unsafe operation reason',
      value: {
        ...MINIMAL_OVERVIEW_RESPONSE,
        lastCleanup: {
          completedAt: '2026-08-31T17:55:10.000Z',
          cooldownEndsAt: '2026-08-31T18:00:10.000Z',
          outcome: 'failed',
          reason: 'raw provider failure',
          startedAt: '2026-08-31T17:55:00.000Z',
        },
      },
    },
    {
      name: 'arbitrary identifier-shaped operation reason',
      value: {
        ...MINIMAL_OVERVIEW_RESPONSE,
        lastCleanup: {
          completedAt: '2026-08-31T17:55:10.000Z',
          cooldownEndsAt: '2026-08-31T18:00:10.000Z',
          outcome: 'failed',
          reason: 'leaked_token_identifier',
          startedAt: '2026-08-31T17:55:00.000Z',
        },
      },
    },
    {
      name: 'unknown Overview property',
      value: {
        ...MINIMAL_OVERVIEW_RESPONSE,
        databasePath: '/data/admin.sqlite',
      },
    },
  ];

export const VALID_METRICS_FIXTURES: readonly OverviewMetricsContractFixture[] =
  [
    { name: 'bounded hourly metrics', value: MINIMAL_METRICS_RESPONSE },
    {
      name: 'empty daily metrics',
      value: {
        fcmBuckets: [],
        from: '2026-08-01T00:00:00.000Z',
        interval: 'day',
        requestBuckets: [],
        to: '2026-08-31T00:00:00.000Z',
      },
    },
  ];

export const INVALID_METRICS_FIXTURES: readonly OverviewMetricsContractFixture[] =
  [
    {
      name: 'unknown interval',
      value: { ...MINIMAL_METRICS_RESPONSE, interval: 'minute' },
    },
    {
      name: 'arbitrary request label',
      value: {
        ...MINIMAL_METRICS_RESPONSE,
        requestBuckets: [
          {
            ...REQUEST_BUCKET,
            outcomes: { ...REQUEST_BUCKET.outcomes, roomId: 1 },
          },
        ],
      },
    },
    {
      name: 'unknown platform',
      value: {
        ...MINIMAL_METRICS_RESPONSE,
        fcmBuckets: [{ ...FCM_BUCKET, platform: 'web' }],
      },
    },
    {
      name: 'too many request buckets',
      value: {
        ...MINIMAL_METRICS_RESPONSE,
        requestBuckets: Array.from({ length: 721 }, () => REQUEST_BUCKET),
      },
    },
  ];
