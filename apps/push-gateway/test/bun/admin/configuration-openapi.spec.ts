import { describe, expect, it } from 'bun:test';

import { configurationOpenApiComponents } from '../../../src/admin-contract/configuration-openapi';

describe('configuration published contract', () => {
  it('projects the canonical response as strict OpenAPI 3.1 JSON Schema', () => {
    const components = configurationOpenApiComponents();

    expect(Object.keys(components)).toEqual([
      'PositiveSafeInteger',
      'ConfigurationSource',
      'SecretPresence',
      'GatewayConfiguration',
      'AdministrationConfiguration',
      'CredentialPresence',
      'Configuration',
    ]);
    expect(components).toMatchObject({
      PositiveSafeInteger: {
        maximum: Number.MAX_SAFE_INTEGER,
        minimum: 1,
        type: 'integer',
      },
      AdministrationConfiguration: {
        additionalProperties: false,
        properties: {
          administrationDatabasePath: {
            maxLength: 4096,
            minLength: 2,
            pattern: '^\\/',
          },
          enabled: { const: true },
          oidcScopes: {
            maxItems: 16,
            minItems: 1,
            uniqueItems: true,
          },
          sessionIdleSeconds: { maximum: 1_800, minimum: 1_800 },
        },
        type: 'object',
      },
      Configuration: {
        additionalProperties: false,
        properties: {
          administration: {
            $ref: '#/components/schemas/AdministrationConfiguration',
          },
          credentials: {
            $ref: '#/components/schemas/CredentialPresence',
          },
          gateway: {
            $ref: '#/components/schemas/GatewayConfiguration',
          },
          observedAt: { $ref: '#/components/schemas/UtcTimestamp' },
        },
        type: 'object',
      },
      GatewayConfiguration: {
        additionalProperties: false,
        properties: {
          maxBodyBytes: {
            $ref: '#/components/schemas/PositiveSafeInteger',
          },
          maxClientInstallationsPerRequest: {
            maximum: 49,
            minimum: 1,
          },
        },
        type: 'object',
      },
      SecretPresence: {
        additionalProperties: false,
        properties: {
          source: { $ref: '#/components/schemas/ConfigurationSource' },
        },
        type: 'object',
      },
    });
  });
});
