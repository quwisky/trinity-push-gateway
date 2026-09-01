import { describe, it } from 'bun:test';

import { CONFIGURATION_RESPONSE_SCHEMA } from '../../../src/admin-contract/configuration';
import { expectContractFixtures } from './support/admin-contract-assertions';
import {
  INVALID_CONFIGURATION_FIXTURES,
  VALID_CONFIGURATION_FIXTURES,
} from './support/configuration-contract-fixtures';

describe('configuration response contract', () => {
  it('keeps runtime and published validation aligned through shared fixtures', () => {
    expectContractFixtures(
      CONFIGURATION_RESPONSE_SCHEMA,
      'Configuration',
      VALID_CONFIGURATION_FIXTURES,
      INVALID_CONFIGURATION_FIXTURES,
    );
  });
});
