import { describe, expect, it } from 'bun:test';

import {
  adminProblemOpenApiResponses,
  operatorActionsOpenApiComponents,
  operatorAuditOpenApiParameters,
} from '../../../src/admin-contract/operator-actions-openapi';

describe('Operator Action published contract', () => {
  it('projects strict audit, backup, result, and problem components', () => {
    const components = operatorActionsOpenApiComponents();

    expect(Object.keys(components)).toEqual([
      'OperationSummaryReason',
      'OperationResultOutcome',
      'OperationResult',
      'AuditEntryKind',
      'AuditEntryOutcome',
      'AuditEntryReason',
      'OperatorAuditEntry',
      'OperatorAuditEntryPage',
      'BackupIntegrity',
      'Backup',
      'BackupList',
      'Problem',
    ]);
    expect(components).toMatchObject({
      OperationResult: {
        additionalProperties: false,
        properties: {
          outcome: {
            $ref: '#/components/schemas/OperationResultOutcome',
          },
          reason: { $ref: '#/components/schemas/OperationSummaryReason' },
        },
      },
      AuditEntryReason: {
        enum: [
          'access_denied',
          'audit_finalization_failed',
          'backup_failed',
          'backup_limit_exceeded',
          'cleanup_failed',
          'firebase_validation_failed',
          'operation_timeout',
          'request_rejected',
          'unavailable',
          'absolute_expired',
          'idle_expired',
          'no_active_sessions',
          'policy_changed',
          'session_cap',
        ],
      },
      OperatorAuditEntry: {
        additionalProperties: false,
        properties: {
          reason: { $ref: '#/components/schemas/AuditEntryReason' },
        },
      },
      Backup: {
        additionalProperties: false,
        properties: {
          name: { pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$' },
        },
      },
    });
  });

  it('publishes the canonical bounded audit policy', () => {
    const parameters = operatorAuditOpenApiParameters();
    expect(parameters).toMatchObject({
      AuditCursor: { schema: { maxLength: 2_048 } },
      AuditLimit: {
        schema: { default: 50, maximum: 100, minimum: 1 },
      },
    });
    expect(parameters.AuditFrom).toEqual({
      description:
        'Inclusive UTC start of the audit range. `from` and `to` must either both be omitted or both be supplied. The maximum range is 90 days.',
      in: 'query',
      name: 'from',
      required: false,
      schema: { $ref: '#/components/schemas/UtcTimestamp' },
    });
    expect(parameters.AuditTo).toEqual({
      description:
        'Exclusive UTC end of the audit range. `from` and `to` must either both be omitted or both be supplied. The maximum range is 90 days.',
      in: 'query',
      name: 'to',
      required: false,
      schema: { $ref: '#/components/schemas/UtcTimestamp' },
    });
  });

  it('projects exact problem tuples and documents every invalid action request', () => {
    const responses = adminProblemOpenApiResponses();
    expect(responses.InvalidRequest).toMatchObject({
      content: {
        'application/problem+json': {
          schema: {
            allOf: [
              { $ref: '#/components/schemas/Problem' },
              {
                properties: {
                  code: { const: 'invalid_request' },
                  status: { const: 400 },
                  title: { const: 'Invalid request' },
                  type: { const: '/admin/problems/invalid_request' },
                },
              },
            ],
          },
        },
      },
    });
    expect(responses.MutationForbidden).toMatchObject({
      content: {
        'application/problem+json': {
          schema: {
            oneOf: [
              {
                allOf: [
                  { $ref: '#/components/schemas/Problem' },
                  { properties: { code: { const: 'forbidden' } } },
                ],
              },
              {
                allOf: [
                  { $ref: '#/components/schemas/Problem' },
                  { properties: { code: { const: 'csrf_failed' } } },
                ],
              },
            ],
          },
        },
      },
    });
  });
});
