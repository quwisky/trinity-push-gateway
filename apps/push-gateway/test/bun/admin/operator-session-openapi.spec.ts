import { describe, expect, it } from 'bun:test';

import { operatorSessionOpenApiComponents } from '../../../src/admin-contract/operator-session-openapi';

describe('Operator Session published contract', () => {
  it('projects the canonical response schema as strict OpenAPI 3.1 JSON Schema', () => {
    const components = operatorSessionOpenApiComponents();

    expect(Object.keys(components)).toEqual([
      'UtcTimestamp',
      'OpaqueId',
      'OperatorIdentity',
      'OperatorSession',
    ]);
    expect(components).toMatchObject({
      UtcTimestamp: {
        format: 'date-time',
        type: 'string',
      },
      OpaqueId: {
        pattern: '^[A-Za-z0-9_-]{16,128}$',
        type: 'string',
      },
      OperatorIdentity: {
        additionalProperties: false,
        properties: {
          issuer: { format: 'uri', type: 'string' },
          subject: { type: 'string' },
        },
        required: ['issuer', 'subject'],
        type: 'object',
      },
      OperatorSession: {
        additionalProperties: false,
        properties: {
          absoluteExpiresAt: {
            $ref: '#/components/schemas/UtcTimestamp',
          },
          current: {
            type: 'boolean',
          },
          id: {
            $ref: '#/components/schemas/OpaqueId',
          },
          operator: {
            $ref: '#/components/schemas/OperatorIdentity',
          },
        },
        required: [
          'id',
          'operator',
          'createdAt',
          'lastSeenAt',
          'idleExpiresAt',
          'absoluteExpiresAt',
          'current',
        ],
        type: 'object',
      },
    });
  });
});
