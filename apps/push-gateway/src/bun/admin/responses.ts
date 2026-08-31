import {
  ADMIN_PROBLEM_SCHEMA,
  adminProblem,
  type AdminProblemCode,
} from '../../admin-contract/operator-actions';
import { validatedAdminResponse } from '../../admin-contract/shared';

export function adminNoStoreHeaders(
  contentType = 'application/json; charset=utf-8',
): Headers {
  return new Headers({
    'cache-control': 'no-store',
    'content-type': contentType,
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
}

export function adminJsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: adminNoStoreHeaders(),
    status,
  });
}

export function adminProblemResponse(
  code: AdminProblemCode,
  retryAfterSeconds?: number,
): Response {
  const headers = adminNoStoreHeaders(
    'application/problem+json; charset=utf-8',
  );
  if (retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(retryAfterSeconds));
  }
  const problem = validatedAdminResponse(
    ADMIN_PROBLEM_SCHEMA,
    adminProblem(code),
  );
  return new Response(JSON.stringify(problem), {
    headers,
    status: problem.status,
  });
}

export function adminNotFoundResponse(): Response {
  return adminProblemResponse('not_found');
}

export function adminUnavailableResponse(): Response {
  return adminProblemResponse('admin_unavailable');
}
