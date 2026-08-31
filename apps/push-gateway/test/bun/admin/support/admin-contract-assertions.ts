import { expect } from 'bun:test';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import { configurationOpenApiComponents } from '../../../../src/admin-contract/configuration-openapi';
import { operatorSessionOpenApiComponents } from '../../../../src/admin-contract/operator-session-openapi';
import { operatorActionsOpenApiComponents } from '../../../../src/admin-contract/operator-actions-openapi';
import { overviewMetricsOpenApiComponents } from '../../../../src/admin-contract/overview-metrics-openapi';
import type { AdminContractFixture } from './admin-contract-fixture';

type ContractValidator = Readonly<{
  safeParse(value: unknown): Readonly<{ success: boolean }>;
}>;

function publishedComponents(): Record<string, unknown> {
  return {
    ...operatorSessionOpenApiComponents(),
    ...overviewMetricsOpenApiComponents(),
    ...configurationOpenApiComponents(),
    ...operatorActionsOpenApiComponents(),
  };
}

function publishedSchema(name: string): ContractValidator {
  const rewritten: unknown = JSON.parse(
    JSON.stringify(publishedComponents()).replaceAll(
      '#/components/schemas/',
      '#/$defs/',
    ),
  );
  if (
    rewritten === null ||
    typeof rewritten !== 'object' ||
    Array.isArray(rewritten)
  ) {
    throw new Error('Published administration components are invalid.');
  }

  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile({
    $defs: rewritten,
    $ref: `#/$defs/${name}`,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
  });
  return {
    safeParse: (value) => ({ success: validate(value) }),
  };
}

export function expectContractFixtures(
  runtimeSchema: ContractValidator,
  publishedSchemaName: string,
  validFixtures: readonly AdminContractFixture[],
  invalidFixtures: readonly AdminContractFixture[],
): void {
  const generatedSchema = publishedSchema(publishedSchemaName);

  for (const fixture of validFixtures) {
    expect(
      runtimeSchema.safeParse(fixture.value).success,
      `runtime contract rejected ${fixture.name}`,
    ).toBe(true);
    expect(
      generatedSchema.safeParse(fixture.value).success,
      `published contract rejected ${fixture.name}`,
    ).toBe(true);
  }

  for (const fixture of invalidFixtures) {
    expect(
      runtimeSchema.safeParse(fixture.value).success,
      `runtime contract accepted ${fixture.name}`,
    ).toBe(false);
    expect(
      generatedSchema.safeParse(fixture.value).success,
      `published contract accepted ${fixture.name}`,
    ).toBe(false);
  }
}
