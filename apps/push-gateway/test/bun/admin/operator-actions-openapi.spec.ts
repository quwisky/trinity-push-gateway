import { describe, expect, it } from 'bun:test';

import {
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
      'ProblemCode',
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
      ProblemCode: {
        enum: [
          'unauthenticated',
          'forbidden',
          'invalid_request',
          'csrf_failed',
          'operation_in_progress',
          'cooldown_active',
          'operation_timeout',
          'outcome_unknown',
          'backup_limit_exceeded',
          'admin_unavailable',
          'not_found',
        ],
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
});
