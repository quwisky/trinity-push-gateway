export type OperatorActionsContractFixture = Readonly<{
  name: string;
  value: unknown;
}>;

const OPERATOR = {
  issuer: 'https://issuer.example/',
  subject: 'operator-1',
} as const;

export const KNOWN_FAILED_OPERATION_RESULT = {
  completedAt: '2026-08-31T18:00:10.000Z',
  cooldownEndsAt: '2026-08-31T18:05:00.000Z',
  outcome: 'failed',
  reason: 'cleanup_failed',
  startedAt: '2026-08-31T18:00:00.000Z',
} as const;

export const VALID_OPERATION_RESULT_FIXTURES: readonly OperatorActionsContractFixture[] =
  [
    { name: 'known failed cleanup', value: KNOWN_FAILED_OPERATION_RESULT },
    {
      name: 'known successful Firebase validation',
      value: {
        ...KNOWN_FAILED_OPERATION_RESULT,
        outcome: 'succeeded',
        reason: undefined,
      },
    },
  ];

export const INVALID_OPERATION_RESULT_FIXTURES: readonly OperatorActionsContractFixture[] =
  [
    {
      name: 'raw provider reason',
      value: {
        ...KNOWN_FAILED_OPERATION_RESULT,
        reason: 'raw_firebase_token_abc123',
      },
    },
    {
      name: 'secret action field',
      value: {
        ...KNOWN_FAILED_OPERATION_RESULT,
        accessToken: 'access-token-sentinel',
      },
    },
    {
      name: 'unknown action outcome',
      value: { ...KNOWN_FAILED_OPERATION_RESULT, outcome: 'outcome_unknown' },
    },
  ];

export const OPERATOR_AUDIT_ENTRY_PAGE = {
  entries: [
    {
      id: 'audit-entry-0001',
      kind: 'cleanup',
      occurredAt: '2026-08-31T18:00:10.000Z',
      operator: OPERATOR,
      outcome: 'failed',
      reason: 'operation_timeout',
    },
  ],
} as const;

export const VALID_AUDIT_PAGE_FIXTURES: readonly OperatorActionsContractFixture[] =
  [
    {
      name: 'bounded Operator Audit Entry page',
      value: OPERATOR_AUDIT_ENTRY_PAGE,
    },
    { name: 'empty final page', value: { entries: [] } },
  ];

export const INVALID_AUDIT_PAGE_FIXTURES: readonly OperatorActionsContractFixture[] =
  [
    {
      name: 'raw audit reason',
      value: {
        entries: [
          {
            ...OPERATOR_AUDIT_ENTRY_PAGE.entries[0],
            reason: 'private_key_contents',
          },
        ],
      },
    },
    {
      name: 'raw identity claims',
      value: {
        entries: [
          {
            ...OPERATOR_AUDIT_ENTRY_PAGE.entries[0],
            operator: { ...OPERATOR, rawClaims: { groups: ['operators'] } },
          },
        ],
      },
    },
    {
      name: 'Matrix identifier',
      value: {
        entries: [
          {
            ...OPERATOR_AUDIT_ENTRY_PAGE.entries[0],
            matrixUserId: '@operator:example.test',
          },
        ],
      },
    },
  ];

export const VERIFIED_BACKUP_LIST = {
  backups: [
    {
      createdAt: '2026-08-31T18:00:10.000Z',
      id: 'backup-record-0001',
      integrity: 'verified',
      name: 'trinity-gateway-20260831T180000Z-abcdef123456.sqlite',
      operator: OPERATOR,
      sha256: 'a'.repeat(64),
      sizeBytes: 4096,
    },
  ],
} as const;

export const VALID_BACKUP_LIST_FIXTURES: readonly OperatorActionsContractFixture[] =
  [
    { name: 'verified backup metadata', value: VERIFIED_BACKUP_LIST },
    { name: 'empty backup list', value: { backups: [] } },
  ];

export const INVALID_BACKUP_LIST_FIXTURES: readonly OperatorActionsContractFixture[] =
  [
    {
      name: 'filesystem path in backup name',
      value: {
        backups: [
          {
            ...VERIFIED_BACKUP_LIST.backups[0],
            name: '/data/backups/gateway.sqlite',
          },
        ],
      },
    },
    {
      name: 'filesystem path field',
      value: {
        backups: [
          {
            ...VERIFIED_BACKUP_LIST.backups[0],
            path: '/data/backups/gateway.sqlite',
          },
        ],
      },
    },
    {
      name: 'service-account field',
      value: {
        backups: [
          {
            ...VERIFIED_BACKUP_LIST.backups[0],
            firebasePrivateKey: 'private-key-sentinel',
          },
        ],
      },
    },
  ];
