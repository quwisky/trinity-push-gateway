import { describe, expect, it } from 'bun:test';

import { CONFIGURATION_RESPONSE_SCHEMA } from '../../../src/admin-contract/configuration';
import { LEGACY_ADMIN_CONFIGURATION_RESPONSE_SCHEMA } from '../../../src/bun/admin/contract';
import {
  INVALID_CONFIGURATION_FIXTURES,
  VALID_CONFIGURATION_FIXTURES,
} from './support/configuration-contract-fixtures';

describe('configuration response contract', () => {
  it('keeps the canonical and migration validators compatible', () => {
    for (const fixture of VALID_CONFIGURATION_FIXTURES) {
      expect(
        CONFIGURATION_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator rejected ${fixture.name}`,
      ).toBe(true);
      expect(
        LEGACY_ADMIN_CONFIGURATION_RESPONSE_SCHEMA.safeParse(fixture.value)
          .success,
        `migration validator rejected ${fixture.name}`,
      ).toBe(true);
    }

    for (const fixture of INVALID_CONFIGURATION_FIXTURES) {
      expect(
        CONFIGURATION_RESPONSE_SCHEMA.safeParse(fixture.value).success,
        `canonical validator accepted ${fixture.name}`,
      ).toBe(false);
      expect(
        LEGACY_ADMIN_CONFIGURATION_RESPONSE_SCHEMA.safeParse(fixture.value)
          .success,
        `migration validator accepted ${fixture.name}`,
      ).toBe(false);
    }
  });
});
