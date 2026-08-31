import { describe, expect, it } from 'bun:test';

import {
  OPERATOR_SESSION_LIST_RESPONSE_SCHEMA,
  OPERATOR_SESSION_RESPONSE_SCHEMA,
} from '../../../src/admin-contract/operator-session';
import { expectContractFixtures } from './support/admin-contract-assertions';
import {
  INVALID_OPERATOR_SESSION_FIXTURES,
  VALID_OPERATOR_SESSION_FIXTURES,
} from './support/operator-session-contract-fixtures';

describe('Operator Session response contract', () => {
  it('keeps runtime and published validation aligned through shared fixtures', () => {
    expectContractFixtures(
      OPERATOR_SESSION_RESPONSE_SCHEMA,
      'OperatorSession',
      VALID_OPERATOR_SESSION_FIXTURES,
      INVALID_OPERATOR_SESSION_FIXTURES,
    );
  });

  it('owns the bounded session-list wrapper', () => {
    const session = VALID_OPERATOR_SESSION_FIXTURES[0]?.value;

    expect(
      OPERATOR_SESSION_LIST_RESPONSE_SCHEMA.safeParse({ sessions: [session] })
        .success,
    ).toBe(true);
    expect(
      OPERATOR_SESSION_LIST_RESPONSE_SCHEMA.safeParse({
        sessions: Array.from({ length: 101 }, () => session),
      }).success,
    ).toBe(false);
    expect(
      OPERATOR_SESSION_LIST_RESPONSE_SCHEMA.safeParse({
        sessions: [session],
        token: 'must-not-leak',
      }).success,
    ).toBe(false);
  });
});
