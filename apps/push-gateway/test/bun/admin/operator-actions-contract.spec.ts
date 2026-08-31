import { describe, expect, it } from 'bun:test';

import {
  ADMIN_PROBLEM_CODES,
  ADMIN_PROBLEM_FIELD_POLICY,
  ADMIN_PROBLEM_SCHEMA,
  BACKUP_LIST_SCHEMA,
  OPERATION_RESULT_SCHEMA,
  OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA,
  adminProblem,
} from '../../../src/admin-contract/operator-actions';
import { expectContractFixtures } from './support/admin-contract-assertions';
import {
  INVALID_AUDIT_PAGE_FIXTURES,
  INVALID_BACKUP_LIST_FIXTURES,
  INVALID_OPERATION_RESULT_FIXTURES,
  VALID_AUDIT_PAGE_FIXTURES,
  VALID_BACKUP_LIST_FIXTURES,
  VALID_OPERATION_RESULT_FIXTURES,
} from './support/operator-actions-contract-fixtures';

describe('Operator Action administration contract', () => {
  it('keeps runtime and published Operator Action result validation aligned', () => {
    expectContractFixtures(
      OPERATION_RESULT_SCHEMA,
      'OperationResult',
      VALID_OPERATION_RESULT_FIXTURES,
      INVALID_OPERATION_RESULT_FIXTURES,
    );
  });

  it('keeps runtime and published audit validation privacy-aligned', () => {
    expectContractFixtures(
      OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA,
      'OperatorAuditEntryPage',
      VALID_AUDIT_PAGE_FIXTURES,
      INVALID_AUDIT_PAGE_FIXTURES,
    );
  });

  it('keeps runtime and published backup validation privacy-aligned', () => {
    expectContractFixtures(
      BACKUP_LIST_SCHEMA,
      'BackupList',
      VALID_BACKUP_LIST_FIXTURES,
      INVALID_BACKUP_LIST_FIXTURES,
    );
  });

  it('keeps runtime and published problem tuples aligned', () => {
    const validProblems = ADMIN_PROBLEM_CODES.map((code) => ({
      name: code,
      value: adminProblem(code),
    }));
    const invalidProblems = [
      {
        name: 'mismatched status',
        value: { ...adminProblem('invalid_request'), status: 401 },
      },
      {
        name: 'mismatched title',
        value: {
          ...adminProblem('invalid_request'),
          title: 'Authentication required',
        },
      },
      {
        name: 'mismatched type',
        value: {
          ...adminProblem('invalid_request'),
          type: '/admin/problems/unauthenticated',
        },
      },
      {
        name: 'oversized detail',
        value: {
          ...adminProblem('invalid_request'),
          detail: 'x'.repeat(
            ADMIN_PROBLEM_FIELD_POLICY.detail.maximumLength + 1,
          ),
        },
      },
      {
        name: 'oversized instance',
        value: {
          ...adminProblem('invalid_request'),
          instance: 'x'.repeat(
            ADMIN_PROBLEM_FIELD_POLICY.instance.maximumLength + 1,
          ),
        },
      },
    ];
    expectContractFixtures(
      ADMIN_PROBLEM_SCHEMA,
      'Problem',
      validProblems,
      invalidProblems,
    );

    for (const code of ADMIN_PROBLEM_CODES) {
      const problem = adminProblem(code);
      expect(problem.type).toBe(`/admin/problems/${code}`);
      expect(JSON.stringify(problem)).not.toContain('sentinel');
      expect(JSON.stringify(problem)).not.toContain('/data/');
    }
  });
});
