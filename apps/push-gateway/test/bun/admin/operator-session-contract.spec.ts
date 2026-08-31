import { describe, expect, it } from 'bun:test';

import {
  OPERATOR_SESSION_LIST_RESPONSE_SCHEMA,
  OPERATOR_SESSION_RESPONSE_SCHEMA,
} from '../../../src/admin-contract/operator-session';
import { ADMIN_OPERATOR_SESSION_SCHEMA } from '../../../src/bun/admin/contract';
import {
  INVALID_OPERATOR_SESSION_FIXTURES,
  VALID_OPERATOR_SESSION_FIXTURES,
} from './support/operator-session-contract-fixtures';

describe('Operator Session response contract', () => {
  it('keeps the canonical and legacy validators compatible', () => {
    for (const fixture of VALID_OPERATOR_SESSION_FIXTURES) {
      expect(
        OPERATOR_SESSION_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator rejected ${fixture.name}`,
      ).toBe(true);
      expect(
        ADMIN_OPERATOR_SESSION_SCHEMA.safeParse(fixture.value).success,
        `legacy validator rejected ${fixture.name}`,
      ).toBe(true);
    }

    for (const fixture of INVALID_OPERATOR_SESSION_FIXTURES) {
      expect(
        OPERATOR_SESSION_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator accepted ${fixture.name}`,
      ).toBe(false);
      expect(
        ADMIN_OPERATOR_SESSION_SCHEMA.safeParse(fixture.value).success,
        `legacy validator accepted ${fixture.name}`,
      ).toBe(false);
    }
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
