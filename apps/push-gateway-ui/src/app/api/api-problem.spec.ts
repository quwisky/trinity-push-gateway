import { HttpErrorResponse } from '@angular/common/http';
import {
  ADMIN_PROBLEM_CATALOG,
  ADMIN_PROBLEM_FIELD_POLICY,
  ADMIN_PROBLEM_SCHEMA,
} from './admin-contract.generated';
import { toSafeApiProblem } from './api-problem';

describe('safe API problem projection', () => {
  it('validates every exact generated tuple and canonical field bound', () => {
    for (const [code, definition] of Object.entries(ADMIN_PROBLEM_CATALOG)) {
      expect(
        ADMIN_PROBLEM_SCHEMA.safeParse({ code, ...definition }).success,
      ).toBe(true);
      expect(
        ADMIN_PROBLEM_SCHEMA.safeParse({
          code,
          ...definition,
          status: definition.status + 1,
        }).success,
      ).toBe(false);
    }
    expect(
      ADMIN_PROBLEM_SCHEMA.safeParse({
        code: 'invalid_request',
        ...ADMIN_PROBLEM_CATALOG.invalid_request,
        detail: 'x'.repeat(ADMIN_PROBLEM_FIELD_POLICY.detail.maximumLength + 1),
      }).success,
    ).toBe(false);
    expect(
      ADMIN_PROBLEM_SCHEMA.safeParse({
        code: 'invalid_request',
        ...ADMIN_PROBLEM_CATALOG.invalid_request,
        instance: 'x'.repeat(
          ADMIN_PROBLEM_FIELD_POLICY.instance.maximumLength + 1,
        ),
      }).success,
    ).toBe(false);
  });

  it('accepts an exact generated problem tuple and sanitizes its detail', () => {
    const definition = ADMIN_PROBLEM_CATALOG.admin_unavailable;
    const problem = toSafeApiProblem(
      new HttpErrorResponse({
        error: {
          code: 'admin_unavailable',
          detail: '  Try again.\u0000  ',
          ...definition,
        },
        status: 503,
      }),
    );

    expect(problem).toEqual({
      detail: 'Try again.',
      status: 503,
      title: 'Administration unavailable',
    });
  });

  it('fails closed for mismatched, unknown, and non-HTTP errors', () => {
    const mismatched = toSafeApiProblem(
      new HttpErrorResponse({
        error: {
          code: 'admin_unavailable',
          ...ADMIN_PROBLEM_CATALOG.admin_unavailable,
          title: 'Provider said too much',
        },
        status: 502,
      }),
    );
    const unknown = toSafeApiProblem(
      new HttpErrorResponse({
        error: { code: 'private_key_contents' },
        status: 500,
      }),
    );
    const unexpectedField = toSafeApiProblem(
      new HttpErrorResponse({
        error: {
          code: 'admin_unavailable',
          ...ADMIN_PROBLEM_CATALOG.admin_unavailable,
          privateDetail: 'must not cross the boundary',
        },
        status: 503,
      }),
    );

    expect(mismatched).toEqual({
      status: 502,
      title: 'The Push Gateway UI request failed.',
    });
    expect(unknown).toEqual({
      status: 500,
      title: 'The Push Gateway UI request failed.',
    });
    expect(unexpectedField).toEqual({
      status: 503,
      title: 'The Push Gateway UI request failed.',
    });
    expect(toSafeApiProblem(new Error('private detail'))).toEqual({
      title: 'The Push Gateway UI request failed.',
    });
  });
});
