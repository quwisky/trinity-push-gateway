import type { AdminContractFixture as OperatorSessionContractFixture } from './admin-contract-fixture';

const MINIMAL_OPERATOR_SESSION = {
  absoluteExpiresAt: '2026-08-31T18:00:00.000Z',
  createdAt: '2026-08-31T10:00:00.000Z',
  current: true,
  id: 'session_contract_01',
  idleExpiresAt: '2026-08-31T10:30:00.000Z',
  lastSeenAt: '2026-08-31T10:05:00.000Z',
  operator: {
    issuer: 'https://identity.example/application/o/gateway/',
    subject: 'operator-1',
  },
} as const;

export const VALID_OPERATOR_SESSION_FIXTURES: readonly OperatorSessionContractFixture[] =
  [
    { name: 'minimal Operator Identity', value: MINIMAL_OPERATOR_SESSION },
    {
      name: 'display attributes',
      value: {
        ...MINIMAL_OPERATOR_SESSION,
        current: false,
        operator: {
          ...MINIMAL_OPERATOR_SESSION.operator,
          displayName: 'Gateway Operator',
          email: 'operator@example.com',
        },
      },
    },
  ];

export const INVALID_OPERATOR_SESSION_FIXTURES: readonly OperatorSessionContractFixture[] =
  [
    {
      name: 'short session identifier',
      value: { ...MINIMAL_OPERATOR_SESSION, id: 'short' },
    },
    {
      name: 'non-UTC timestamp',
      value: {
        ...MINIMAL_OPERATOR_SESSION,
        lastSeenAt: '2026-08-31T12:05:00+02:00',
      },
    },
    {
      name: 'impossible UTC timestamp',
      value: {
        ...MINIMAL_OPERATOR_SESSION,
        lastSeenAt: '2026-99-99T99:99:99Z',
      },
    },
    {
      name: 'invalid issuer URI',
      value: {
        ...MINIMAL_OPERATOR_SESSION,
        operator: {
          ...MINIMAL_OPERATOR_SESSION.operator,
          issuer: 'not a uri',
        },
      },
    },
    {
      name: 'empty display name',
      value: {
        ...MINIMAL_OPERATOR_SESSION,
        operator: { ...MINIMAL_OPERATOR_SESSION.operator, displayName: '' },
      },
    },
    {
      name: 'invalid display email',
      value: {
        ...MINIMAL_OPERATOR_SESSION,
        operator: {
          ...MINIMAL_OPERATOR_SESSION.operator,
          email: 'not-an-email',
        },
      },
    },
    {
      name: 'unknown response property',
      value: { ...MINIMAL_OPERATOR_SESSION, sessionToken: 'must-not-leak' },
    },
    {
      name: 'unknown Operator Identity property',
      value: {
        ...MINIMAL_OPERATOR_SESSION,
        operator: {
          ...MINIMAL_OPERATOR_SESSION.operator,
          groups: ['gateway-operators'],
        },
      },
    },
  ];
