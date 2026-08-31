import { describe, expect, it } from 'bun:test';

import {
  ADMIN_PROBLEM_CODES,
  ADMIN_PROBLEM_SCHEMA,
  BACKUP_LIST_SCHEMA,
  OPERATION_RESULT_SCHEMA,
  OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA,
  adminProblem,
} from '../../../src/admin-contract/operator-actions';
import {
  LEGACY_ADMIN_AUDIT_PAGE_SCHEMA,
  LEGACY_ADMIN_BACKUP_LIST_SCHEMA,
  LEGACY_ADMIN_OPERATION_RESULT_SCHEMA,
} from '../../../src/bun/admin/contract';
import {
  INVALID_AUDIT_PAGE_FIXTURES,
  INVALID_BACKUP_LIST_FIXTURES,
  INVALID_OPERATION_RESULT_FIXTURES,
  VALID_AUDIT_PAGE_FIXTURES,
  VALID_BACKUP_LIST_FIXTURES,
  VALID_OPERATION_RESULT_FIXTURES,
} from './support/operator-actions-contract-fixtures';

function expectParity(
  canonical: { safeParse(value: unknown): { success: boolean } },
  legacy: { safeParse(value: unknown): { success: boolean } },
  valid: readonly Readonly<{ name: string; value: unknown }>[],
  invalid: readonly Readonly<{ name: string; value: unknown }>[],
): void {
  for (const fixture of valid) {
    expect(
      canonical.safeParse(fixture.value).success,
      `canonical validator rejected ${fixture.name}`,
    ).toBe(true);
    expect(
      legacy.safeParse(fixture.value).success,
      `migration validator rejected ${fixture.name}`,
    ).toBe(true);
  }
  for (const fixture of invalid) {
    expect(
      canonical.safeParse(fixture.value).success,
      `canonical validator accepted ${fixture.name}`,
    ).toBe(false);
    expect(
      legacy.safeParse(fixture.value).success,
      `migration validator accepted ${fixture.name}`,
    ).toBe(false);
  }
}

describe('Operator Action administration contract', () => {
  it('keeps canonical and migration Operator Action result validators compatible', () => {
    expectParity(
      OPERATION_RESULT_SCHEMA,
      LEGACY_ADMIN_OPERATION_RESULT_SCHEMA,
      VALID_OPERATION_RESULT_FIXTURES,
      INVALID_OPERATION_RESULT_FIXTURES,
    );
  });

  it('keeps canonical and migration audit validators privacy-compatible', () => {
    expectParity(
      OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA,
      LEGACY_ADMIN_AUDIT_PAGE_SCHEMA,
      VALID_AUDIT_PAGE_FIXTURES,
      INVALID_AUDIT_PAGE_FIXTURES,
    );
  });

  it('keeps canonical and migration backup validators privacy-compatible', () => {
    expectParity(
      BACKUP_LIST_SCHEMA,
      LEGACY_ADMIN_BACKUP_LIST_SCHEMA,
      VALID_BACKUP_LIST_FIXTURES,
      INVALID_BACKUP_LIST_FIXTURES,
    );
  });

  it('constructs every problem from one fixed code, status, and title catalog', () => {
    for (const code of ADMIN_PROBLEM_CODES) {
      const problem = adminProblem(code);
      expect(ADMIN_PROBLEM_SCHEMA.safeParse(problem).success).toBe(true);
      expect(problem.type).toBe(`/admin/problems/${code}`);
      expect(JSON.stringify(problem)).not.toContain('sentinel');
      expect(JSON.stringify(problem)).not.toContain('/data/');
    }
    expect(
      ADMIN_PROBLEM_SCHEMA.safeParse({
        ...adminProblem('invalid_request'),
        status: 401,
      }).success,
    ).toBe(false);
    expect(
      ADMIN_PROBLEM_SCHEMA.safeParse({
        ...adminProblem('invalid_request'),
        title: 'Authentication required',
      }).success,
    ).toBe(false);
    expect(
      ADMIN_PROBLEM_SCHEMA.safeParse({
        ...adminProblem('invalid_request'),
        type: '/admin/problems/unauthenticated',
      }).success,
    ).toBe(false);
  });
});
