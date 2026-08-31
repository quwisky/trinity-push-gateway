import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

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
    expect(JSON.stringify(parameters.AuditFrom)).toContain('90 days');
    expect(JSON.stringify(parameters.AuditTo)).toContain('90 days');
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
    expect(
      JSON.stringify(responses.MutationForbidden).match(
        /"code":\{"const":"(?:forbidden|csrf_failed)"\}/gu,
      ),
    ).toHaveLength(2);

    const openApi = readFileSync(
      path.join(import.meta.dir, '../../../openapi/admin-v1.yaml'),
      'utf8',
    );
    for (const [route, nextRoute] of [
      ['/backups:', '/operations/cleanup:'],
      ['/operations/cleanup:', '/operations/firebase-validation:'],
      ['/operations/firebase-validation:', 'components:'],
    ] as const) {
      const operation = openApi.slice(
        openApi.indexOf(`  ${route}`),
        openApi.indexOf(`  ${nextRoute}`),
      );
      const expectedInvalidResponses = route === '/backups:' ? 2 : 1;
      expect(
        operation.match(
          /'400':\n\s+\$ref: '#\/components\/responses\/InvalidRequest'/gu,
        ),
      ).toHaveLength(expectedInvalidResponses);
    }
  });
});
