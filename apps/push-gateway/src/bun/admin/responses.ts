export type AdminProblemCode =
  | 'admin_unavailable'
  | 'csrf_failed'
  | 'forbidden'
  | 'invalid_request'
  | 'not_found'
  | 'operation_in_progress'
  | 'cooldown_active'
  | 'operation_timeout'
  | 'outcome_unknown'
  | 'backup_limit_exceeded'
  | 'unauthenticated';

const PROBLEM_TITLES: Readonly<Record<AdminProblemCode, string>> = {
  admin_unavailable: 'Administration unavailable',
  csrf_failed: 'Request validation failed',
  forbidden: 'Forbidden',
  invalid_request: 'Invalid request',
  not_found: 'Not found',
  operation_in_progress: 'Operation already in progress',
  cooldown_active: 'Operation cooldown active',
  operation_timeout: 'Operation timed out',
  outcome_unknown: 'Operation outcome unknown',
  backup_limit_exceeded: 'Backup limit exceeded',
  unauthenticated: 'Authentication required',
};

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
  status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503 | 504 | 507,
  retryAfterSeconds?: number,
): Response {
  const headers = adminNoStoreHeaders(
    'application/problem+json; charset=utf-8',
  );
  if (retryAfterSeconds !== undefined) {
    headers.set('retry-after', String(retryAfterSeconds));
  }
  return new Response(
    JSON.stringify({
      code,
      status,
      title: PROBLEM_TITLES[code],
      type: `/admin/problems/${code}`,
    }),
    {
      headers,
      status,
    },
  );
}

export function adminNotFoundResponse(): Response {
  return adminProblemResponse('not_found', 404);
}

export function adminUnavailableResponse(): Response {
  return adminProblemResponse('admin_unavailable', 503);
}
