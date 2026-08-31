import { describe, expect, it } from 'bun:test';

import { OPERATOR_SESSION_RESPONSE_SCHEMA } from '../../../src/admin-contract/operator-session';
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
});
