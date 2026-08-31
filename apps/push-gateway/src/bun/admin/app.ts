import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';

import { Hono, type Context } from 'hono';
import {
  deleteCookie,
  generateCookie,
  getCookie,
  setCookie,
} from 'hono/cookie';

import { version as gatewayVersion } from '../../../../../package.json';
import { OPERATOR_SESSION_RESPONSE_SCHEMA } from '../../admin-contract/operator-session';
import type { BunConfiguration } from '../config';
import {
  createOidcAuthenticator,
  OidcAuthenticationError,
  type OidcAuthenticator,
} from '../auth/oidc-client';
import type { AdminAssetCatalog } from './assets';
import type { AdminOperations, OperationResponse } from './operations';
import type { AdminConfiguration, SafeAdminConfiguration } from './config';
import {
  ADMIN_AUDIT_PAGE_SCHEMA,
  ADMIN_BACKUP_LIST_SCHEMA,
  ADMIN_BACKUP_SCHEMA,
  ADMIN_CONFIGURATION_RESPONSE_SCHEMA,
  ADMIN_METRICS_SCHEMA,
  ADMIN_OPERATION_RESULT_SCHEMA,
  ADMIN_OPERATOR_SESSION_LIST_SCHEMA,
  ADMIN_OVERVIEW_SCHEMA,
  ADMIN_SESSION_ID_SCHEMA,
  validatedAdminResponse,
} from './contract';
import {
  adminJsonResponse,
  adminNoStoreHeaders,
  adminNotFoundResponse,
  adminProblemResponse,
  adminUnavailableResponse,
} from './responses';
import { ADMIN_AUDIT_KINDS, ADMIN_AUDIT_OUTCOMES } from './schema';
import {
  type AdminAuthenticatedSession,
  type AdminOperatorSession,
  SqliteAdminStore,
} from './store';

const SESSION_COOKIE = 'TRINITY_ADMIN_SESSION';
const XSRF_COOKIE = 'TRINITY_ADMIN_XSRF';
const OIDC_COOKIE = 'TRINITY_ADMIN_OIDC';
const API_PREFIX = '/admin/api/';
const AUTH_PREFIX = '/admin/auth/';

type AdminApplicationOptions = Readonly<{
  assets: AdminAssetCatalog;
  configuration: AdminConfiguration;
  gatewayConfiguration: BunConfiguration;
  gatewayReady: () => boolean;
  now?: () => number;
  operations?: Pick<
    AdminOperations,
    'backup' | 'cleanup' | 'firebaseValidation'
  >;
  safeConfiguration: SafeAdminConfiguration;
  startedAt?: number;
  store: SqliteAdminStore;
}>;

export type AdminSurface = Readonly<{
  cleanup(nowSeconds: number): Promise<void>;
  close(): void;
  fetch(request: Request): Promise<Response>;
  purgeSessions(nowSeconds: number): Promise<number>;
}>;

type AuthenticationResult =
  | Readonly<{
      kind: 'active';
      session: AdminAuthenticatedSession;
    }>
  | Readonly<{
      kind: 'response';
      response: Response;
    }>;

type AuthenticatedRoute = (
  context: Context,
  session: AdminAuthenticatedSession,
) => Promise<Response> | Response;

type AdminRouteHandler = (context: Context) => Promise<Response>;

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

function randomOpaqueId(): string {
  return randomBytes(18).toString('base64url');
}

function digest(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret)
    .update('trinity-push-gateway-admin\0')
    .update(purpose)
    .update('\0')
    .update(value)
    .digest('base64url');
}

function secretsEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function secondsToTimestamp(seconds: number): string {
  return new Date(seconds * 1_000).toISOString();
}

function sessionProjection(
  session: AdminOperatorSession,
  currentSessionId: string,
): unknown {
  return {
    absoluteExpiresAt: secondsToTimestamp(session.absoluteExpiresAt),
    createdAt: secondsToTimestamp(session.createdAt),
    current: session.id === currentSessionId,
    id: session.id,
    idleExpiresAt: secondsToTimestamp(session.idleExpiresAt),
    lastSeenAt: secondsToTimestamp(session.lastSeenAt),
    operator: session.operator,
  };
}

function safeFileSize(filePath: string): number {
  try {
    const size = statSync(filePath).size;
    return Number.isSafeInteger(size) && size >= 0 ? size : 0;
  } catch {
    return 0;
  }
}

type EffectiveRange = Readonly<{
  from: number;
  interval: 'day' | 'hour';
  to: number;
}>;

function parseRange(
  url: URL,
  nowSeconds: number,
  maximumSeconds: number,
  allowInterval: boolean,
): EffectiveRange | undefined {
  const allowed = new Set([
    'from',
    'to',
    ...(allowInterval ? ['interval'] : []),
  ]);
  if (
    [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => url.searchParams.getAll(key).length > 1)
  ) {
    return undefined;
  }
  const rawFrom = url.searchParams.get('from');
  const rawTo = url.searchParams.get('to');
  if ((rawFrom === null) !== (rawTo === null)) return undefined;
  const to =
    rawTo === null ? nowSeconds : Math.floor(Date.parse(rawTo) / 1_000);
  const from =
    rawFrom === null
      ? to - 24 * 60 * 60
      : Math.floor(Date.parse(rawFrom) / 1_000);
  const interval = url.searchParams.get('interval') ?? 'hour';
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to - from > maximumSeconds ||
    (interval !== 'hour' && interval !== 'day')
  ) {
    return undefined;
  }
  return { from, interval, to };
}

const ZERO_REQUEST_OUTCOMES = Object.freeze({
  invalid: 0,
  processed: 0,
  rateLimited: 0,
  safetyBudgetExhausted: 0,
  storageUnavailable: 0,
});
const ZERO_FCM_OUTCOMES = Object.freeze({
  accepted: 0,
  attempted: 0,
  permanentlyRejected: 0,
  transientFailure: 0,
});

function safeCountAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function fcmAttempted(
  row: Readonly<{
    accepted: number;
    permanentlyRejected: number;
    transientFailure: number;
  }>,
): number {
  return safeCountAdd(
    safeCountAdd(row.accepted, row.permanentlyRejected),
    row.transientFailure,
  );
}

function metricsProjection(
  rows: ReturnType<SqliteAdminStore['metrics']>,
  range: EffectiveRange,
): unknown {
  const seconds = range.interval === 'hour' ? 3_600 : 86_400;
  const bucketStart = (hour: number): number =>
    Math.floor(hour / seconds) * seconds;
  const requests = new Map<
    number,
    Record<keyof typeof ZERO_REQUEST_OUTCOMES, number>
  >();
  for (const row of rows.requests) {
    const key = bucketStart(row.hour);
    const aggregate = requests.get(key) ?? { ...ZERO_REQUEST_OUTCOMES };
    aggregate.invalid = safeCountAdd(aggregate.invalid, row.invalid);
    aggregate.processed = safeCountAdd(aggregate.processed, row.processed);
    aggregate.rateLimited = safeCountAdd(
      aggregate.rateLimited,
      row.rateLimited,
    );
    aggregate.safetyBudgetExhausted = safeCountAdd(
      aggregate.safetyBudgetExhausted,
      row.safetyBudgetExhausted,
    );
    aggregate.storageUnavailable = safeCountAdd(
      aggregate.storageUnavailable,
      row.storageUnavailable,
    );
    requests.set(key, aggregate);
  }
  const fcm = new Map<string, (typeof rows.fcm)[number]>();
  for (const row of rows.fcm) {
    const keyHour = bucketStart(row.hour);
    const key = `${String(keyHour)}:${row.platform}`;
    const previous = fcm.get(key);
    fcm.set(
      key,
      previous === undefined
        ? { ...row, hour: keyHour }
        : (Object.fromEntries(
            Object.entries(row).map(([field, value]) => [
              field,
              typeof value === 'number' && field !== 'hour'
                ? safeCountAdd(
                    value,
                    Number(previous[field as keyof typeof previous]),
                  )
                : field === 'hour'
                  ? keyHour
                  : value,
            ]),
          ) as typeof row),
    );
  }
  const fcmBuckets = [...fcm.values()].map((row) => {
    const histogram = {
      under_100_ms: row.latencyUnder100,
      '100_to_249_ms': row.latency100To249,
      '250_to_499_ms': row.latency250To499,
      '500_to_999_ms': row.latency500To999,
      '1000_to_2499_ms': row.latency1000To2499,
      '2500_to_4999_ms': row.latency2500To4999,
      '5000_to_9999_ms': row.latency5000To9999,
      '10000_ms_or_more': row.latency10000OrMore,
    };
    const sampleCount = Object.values(histogram).reduce(
      (sum, value) => safeCountAdd(sum, value),
      0,
    );
    const bounds = [100, 250, 500, 1_000, 2_500, 5_000, 10_000, 10_000];
    let cumulative = 0;
    const approxP95Ms =
      sampleCount === 0
        ? null
        : (bounds.find((_, index) => {
            cumulative = safeCountAdd(
              cumulative,
              Object.values(histogram)[index] ?? 0,
            );
            return cumulative >= sampleCount * 0.95;
          }) ?? 10_000);
    return {
      from: secondsToTimestamp(row.hour),
      latency: { approxP95Ms, histogram, sampleCount },
      outcomes: {
        accepted: row.accepted,
        attempted: fcmAttempted(row),
        permanentlyRejected: row.permanentlyRejected,
        transientFailure: row.transientFailure,
      },
      platform: row.platform,
      to: secondsToTimestamp(row.hour + seconds),
    };
  });
  return {
    fcmBuckets,
    from: secondsToTimestamp(range.from),
    interval: range.interval,
    requestBuckets: [...requests.entries()].map(([from, outcomes]) => ({
      from: secondsToTimestamp(from),
      outcomes,
      to: secondsToTimestamp(from + seconds),
    })),
    to: secondsToTimestamp(range.to),
  };
}

function operationProjection(result: OperationResponse): Response {
  if (result.kind === 'busy') {
    return adminProblemResponse('operation_in_progress', 409);
  }
  if (result.kind === 'cooldown') {
    return adminProblemResponse(
      'cooldown_active',
      429,
      result.retryAfterSeconds,
    );
  }
  if (result.kind === 'timeout') {
    return adminProblemResponse('operation_timeout', 504);
  }
  if (result.kind === 'outcome_unknown') {
    return adminProblemResponse('outcome_unknown', 500);
  }
  if (result.kind === 'limit') {
    return adminProblemResponse('backup_limit_exceeded', 507);
  }
  if (result.kind === 'unavailable') {
    return adminUnavailableResponse();
  }
  const projected = {
    completedAt: secondsToTimestamp(result.result.completedAt),
    cooldownEndsAt: secondsToTimestamp(result.result.cooldownEndsAt),
    outcome: result.result.outcome,
    ...(result.result.reason === undefined
      ? {}
      : { reason: result.result.reason }),
    startedAt: secondsToTimestamp(result.result.startedAt),
  };
  if (result.kind === 'backup') {
    return adminJsonResponse(
      validatedAdminResponse(
        ADMIN_BACKUP_SCHEMA,
        backupProjection(result.backup),
      ),
      201,
    );
  }
  return adminJsonResponse(
    validatedAdminResponse(ADMIN_OPERATION_RESULT_SCHEMA, projected),
  );
}

function backupProjection(
  backup: ReturnType<SqliteAdminStore['listBackups']>[number],
): unknown {
  return {
    createdAt: secondsToTimestamp(backup.createdAt),
    id: backup.id,
    integrity: 'verified',
    name: backup.name,
    operator:
      backup.issuer === null || backup.subject === null
        ? null
        : { issuer: backup.issuer, subject: backup.subject },
    sha256: backup.sha256,
    sizeBytes: backup.sizeBytes,
  };
}

function isEmptyMutation(context: Context): boolean {
  return (
    new URL(context.req.url).search === '' && context.req.raw.body === null
  );
}

function setSessionCookies(
  context: Context,
  sessionToken: string,
  xsrfToken: string,
): void {
  setCookie(context, SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    path: '/',
    sameSite: 'Strict',
    secure: true,
  });
  setCookie(context, XSRF_COOKIE, xsrfToken, {
    httpOnly: false,
    path: '/admin',
    sameSite: 'Strict',
    secure: true,
  });
}

function clearSessionCookies(context: Context): void {
  deleteCookie(context, SESSION_COOKIE, {
    path: '/',
    sameSite: 'Strict',
    secure: true,
  });
  deleteCookie(context, XSRF_COOKIE, {
    path: '/admin',
    sameSite: 'Strict',
    secure: true,
  });
}

function withClearedSessionCookies(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.append(
    'set-cookie',
    generateCookie(SESSION_COOKIE, '', {
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'Strict',
      secure: true,
    }),
  );
  headers.append(
    'set-cookie',
    generateCookie(XSRF_COOKIE, '', {
      httpOnly: false,
      maxAge: 0,
      path: '/admin',
      sameSite: 'Strict',
      secure: true,
    }),
  );
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function setOidcCookie(context: Context, token: string): void {
  setCookie(context, OIDC_COOKIE, token, {
    httpOnly: true,
    maxAge: 5 * 60,
    path: '/admin/auth/callback',
    sameSite: 'Lax',
    secure: true,
  });
}

function clearOidcCookie(context: Context): void {
  deleteCookie(context, OIDC_COOKIE, {
    path: '/admin/auth/callback',
    sameSite: 'Lax',
    secure: true,
  });
}

function redirectResponse(context: Context, location: string): Response {
  context.header('cache-control', 'no-store');
  context.header('referrer-policy', 'no-referrer');
  context.header('x-content-type-options', 'nosniff');
  return context.redirect(location, 303);
}

function callbackFailureReason(error: unknown): string {
  if (!(error instanceof OidcAuthenticationError)) {
    return 'unavailable';
  }
  if (error.code === 'required_group_missing') {
    return 'forbidden';
  }
  return error.code === 'login_state_invalid'
    ? 'unauthenticated'
    : 'unavailable';
}

function configurationProjection(
  options: AdminApplicationOptions,
  observedAt: string,
): unknown {
  return {
    administration: options.safeConfiguration.administration,
    credentials: {
      ...options.gatewayConfiguration.safe.credentials,
      oidcClientSecret: options.safeConfiguration.credentials.oidcClientSecret,
      sessionSecret: options.safeConfiguration.credentials.sessionSecret,
    },
    gateway: options.gatewayConfiguration.safe.gateway,
    observedAt,
    version: gatewayVersion,
  };
}

export function createAdminSurface(
  options: AdminApplicationOptions,
): AdminSurface {
  const now = options.now ?? Date.now;
  const startedAt = options.startedAt ?? now();
  const secret = options.configuration.sessionSecret.value;
  const callbackUrl = `${options.configuration.publicOrigin}/admin/auth/callback`;
  let authenticatorPromise: Promise<OidcAuthenticator> | undefined;
  let resolvedAuthenticator: OidcAuthenticator | undefined;
  let lastCleanupHour: number | undefined;
  let lastCleanupDay: number | undefined;
  const cursorFor = (payload: Readonly<Record<string, unknown>>): string => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${digest(secret, 'audit-cursor', encoded)}`;
  };
  const parseCursor = (
    value: string,
  ): Readonly<Record<string, unknown>> | undefined => {
    const [encoded, signature, extra] = value.split('.');
    if (
      encoded === undefined ||
      signature === undefined ||
      extra !== undefined ||
      !secretsEqual(signature, digest(secret, 'audit-cursor', encoded))
    ) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      );
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Readonly<Record<string, unknown>>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const authenticator = (): Promise<OidcAuthenticator> => {
    authenticatorPromise ??= createOidcAuthenticator(
      {
        callbackUrl,
        clientId: options.configuration.oidcClientId,
        clientSecret: options.configuration.oidcClientSecret.value,
        clientSecretMethod: options.configuration.oidcTokenEndpointAuthMethod,
        groupClaim: options.configuration.oidcGroupClaim,
        issuer: options.configuration.oidcIssuer,
        requiredGroup: options.configuration.oidcRequiredGroup,
        scopes: options.configuration.oidcScopes,
      },
      options.store,
      { nowSeconds: () => Math.floor(now() / 1_000) },
    )
      .then((created) => {
        resolvedAuthenticator = created;
        return created;
      })
      .catch((error: unknown) => {
        authenticatorPromise = undefined;
        throw error;
      });
    return authenticatorPromise;
  };

  const authenticate = async (
    context: Context,
  ): Promise<AuthenticationResult> => {
    const sessionToken = getCookie(context, SESSION_COOKIE);
    if (sessionToken === undefined || sessionToken.length > 256) {
      return {
        kind: 'response',
        response: adminProblemResponse('unauthenticated', 401),
      };
    }
    const result = await options.store.authenticateSession(
      digest(secret, 'session', sessionToken),
      Math.floor(now() / 1_000),
      options.configuration.policyFingerprint,
    );
    if (result.kind !== 'active') {
      return {
        kind: 'response',
        response: withClearedSessionCookies(
          adminProblemResponse('unauthenticated', 401),
        ),
      };
    }
    return { kind: 'active', session: result.session };
  };

  const authorizeMutation = (
    context: Context,
    session: AdminAuthenticatedSession,
  ): boolean => {
    const cookieToken = getCookie(context, XSRF_COOKIE);
    const headerToken = context.req.header('X-XSRF-TOKEN');
    if (
      context.req.header('Origin') !== options.configuration.publicOrigin ||
      cookieToken === undefined ||
      headerToken === undefined ||
      cookieToken.length > 256 ||
      !secretsEqual(cookieToken, headerToken)
    ) {
      return false;
    }
    return secretsEqual(
      digest(secret, 'xsrf', cookieToken),
      session.xsrfDigest,
    );
  };

  const authenticatedRoute =
    (route: AuthenticatedRoute) =>
    async (context: Context): Promise<Response> => {
      const authenticated = await authenticate(context);
      return authenticated.kind === 'response'
        ? authenticated.response
        : route(context, authenticated.session);
    };

  const mutationRoute = (route: AuthenticatedRoute): AdminRouteHandler =>
    authenticatedRoute((context, session) =>
      authorizeMutation(context, session)
        ? route(context, session)
        : adminProblemResponse('csrf_failed', 403),
    );

  const app = new Hono({ strict: true });

  app.get('/admin/auth/login', async (context) => {
    const oidcCookie = randomToken();
    try {
      const authorizationUrl = await (
        await authenticator()
      ).beginLogin(digest(secret, 'oidc', oidcCookie));
      setOidcCookie(context, oidcCookie);
      return redirectResponse(context, authorizationUrl.href);
    } catch {
      return adminUnavailableResponse();
    }
  });

  app.get('/admin/auth/callback', async (context) => {
    const oidcCookie = getCookie(context, OIDC_COOKIE);
    clearOidcCookie(context);
    if (oidcCookie === undefined || oidcCookie.length > 256) {
      return redirectResponse(context, '/admin/sign-in?reason=unauthenticated');
    }
    try {
      const identity = await (
        await authenticator()
      ).completeLogin(
        new URL(context.req.url),
        digest(secret, 'oidc', oidcCookie),
      );
      const sessionToken = randomToken();
      const xsrfToken = randomToken();
      await options.store.establishSession(identity, {
        id: randomOpaqueId(),
        nowSeconds: Math.floor(now() / 1_000),
        policyFingerprint: options.configuration.policyFingerprint,
        sessionDigest: digest(secret, 'session', sessionToken),
        xsrfDigest: digest(secret, 'xsrf', xsrfToken),
      });
      setSessionCookies(context, sessionToken, xsrfToken);
      return redirectResponse(context, '/admin/overview');
    } catch (error) {
      return redirectResponse(
        context,
        `/admin/sign-in?reason=${callbackFailureReason(error)}`,
      );
    }
  });

  app.post(
    '/admin/auth/logout',
    mutationRoute(async (context, session) => {
      await options.store.logoutSession(
        session.id,
        Math.floor(now() / 1_000),
        session.operator,
      );
      clearSessionCookies(context);
      let providerLogout: URL | undefined;
      try {
        providerLogout = resolvedAuthenticator?.buildProviderLogoutUrl();
      } catch {
        providerLogout = undefined;
      }
      return redirectResponse(
        context,
        providerLogout?.href ?? '/admin/sign-in?reason=unauthenticated',
      );
    }),
  );

  app.get(
    '/admin/api/v1/session',
    authenticatedRoute((_context, session) => {
      return adminJsonResponse(
        validatedAdminResponse(
          OPERATOR_SESSION_RESPONSE_SCHEMA,
          sessionProjection(session, session.id),
        ),
      );
    }),
  );

  app.get(
    '/admin/api/v1/sessions',
    authenticatedRoute(async (_context, currentSession) => {
      const sessions = await options.store.listSessions(
        Math.floor(now() / 1_000),
        options.configuration.policyFingerprint,
      );
      return adminJsonResponse(
        validatedAdminResponse(ADMIN_OPERATOR_SESSION_LIST_SCHEMA, {
          sessions: sessions.map((session) =>
            sessionProjection(session, currentSession.id),
          ),
        }),
      );
    }),
  );

  app.delete(
    '/admin/api/v1/sessions/:sessionId',
    mutationRoute(async (context, currentSession) => {
      const parsedSessionId = ADMIN_SESSION_ID_SCHEMA.safeParse(
        context.req.param('sessionId'),
      );
      if (!parsedSessionId.success) {
        return adminProblemResponse('invalid_request', 400);
      }
      const revoked = await options.store.revokeSession(
        parsedSessionId.data,
        Math.floor(now() / 1_000),
        currentSession.operator,
      );
      if (!revoked) {
        return adminNotFoundResponse();
      }
      const headers = adminNoStoreHeaders();
      headers.delete('content-type');
      if (parsedSessionId.data === currentSession.id) {
        return withClearedSessionCookies(
          new Response(null, { headers, status: 204 }),
        );
      }
      return new Response(null, { headers, status: 204 });
    }),
  );

  app.get(
    '/admin/api/v1/configuration',
    authenticatedRoute(() => {
      const observedAt = new Date(now()).toISOString();
      return adminJsonResponse(
        validatedAdminResponse(
          ADMIN_CONFIGURATION_RESPONSE_SCHEMA,
          configurationProjection(options, observedAt),
        ),
      );
    }),
  );

  app.get(
    '/admin/api/v1/overview',
    authenticatedRoute(() => {
      const observedAtMs = now();
      const observedAtSeconds = Math.floor(observedAtMs / 1_000);
      const metricRows = options.store.metrics(
        observedAtSeconds - 24 * 60 * 60,
        observedAtSeconds,
      );
      const requestTotals = metricRows.requests.reduce<
        Record<keyof typeof ZERO_REQUEST_OUTCOMES, number>
      >(
        (totals, row) => ({
          invalid: safeCountAdd(totals.invalid, row.invalid),
          processed: safeCountAdd(totals.processed, row.processed),
          rateLimited: safeCountAdd(totals.rateLimited, row.rateLimited),
          safetyBudgetExhausted: safeCountAdd(
            totals.safetyBudgetExhausted,
            row.safetyBudgetExhausted,
          ),
          storageUnavailable: safeCountAdd(
            totals.storageUnavailable,
            row.storageUnavailable,
          ),
        }),
        { ...ZERO_REQUEST_OUTCOMES },
      );
      const fcmTotals: Record<
        'android' | 'ios',
        Record<keyof typeof ZERO_FCM_OUTCOMES, number>
      > = {
        android: { ...ZERO_FCM_OUTCOMES },
        ios: { ...ZERO_FCM_OUTCOMES },
      };
      for (const row of metricRows.fcm) {
        const totals = fcmTotals[row.platform];
        totals.accepted = safeCountAdd(totals.accepted, row.accepted);
        totals.permanentlyRejected = safeCountAdd(
          totals.permanentlyRejected,
          row.permanentlyRejected,
        );
        totals.transientFailure = safeCountAdd(
          totals.transientFailure,
          row.transientFailure,
        );
        totals.attempted = fcmAttempted(totals);
      }
      const summaries = Object.fromEntries(
        options.store.operationSummaries().map((summary) => [
          summary.kind,
          {
            completedAt: secondsToTimestamp(summary.completedAt),
            cooldownEndsAt: secondsToTimestamp(summary.cooldownEndsAt),
            outcome: summary.outcome,
            ...(summary.reason === null ? {} : { reason: summary.reason }),
            startedAt: secondsToTimestamp(summary.acquiredAt),
          },
        ]),
      );
      return adminJsonResponse(
        validatedAdminResponse(ADMIN_OVERVIEW_SCHEMA, {
          // Authentication immediately above proved the isolated store usable;
          // avoid running an integrity scan for every overview request.
          administrationReady: true,
          databaseBytes: {
            administration: safeFileSize(options.configuration.databasePath),
            gateway: safeFileSize(options.gatewayConfiguration.databasePath),
          },
          fcmAttemptsLast24Hours: fcmTotals,
          gatewayReady: options.gatewayReady(),
          observedAt: new Date(observedAtMs).toISOString(),
          ...(summaries.backup === undefined
            ? {}
            : { lastBackup: summaries.backup }),
          ...(summaries.cleanup === undefined
            ? {}
            : { lastCleanup: summaries.cleanup }),
          ...(summaries.firebase_validation === undefined
            ? {}
            : { lastFirebaseValidation: summaries.firebase_validation }),
          requestsLast24Hours: requestTotals,
          uptimeSeconds: Math.max(
            0,
            Math.floor((observedAtMs - startedAt) / 1_000),
          ),
          version: gatewayVersion,
        }),
      );
    }),
  );

  app.get(
    '/admin/api/v1/metrics',
    authenticatedRoute((context) => {
      const range = parseRange(
        new URL(context.req.url),
        Math.floor(now() / 1_000),
        30 * 24 * 60 * 60,
        true,
      );
      if (range === undefined) {
        return adminProblemResponse('invalid_request', 400);
      }
      const rows = options.store.metrics(range.from, range.to);
      return adminJsonResponse(
        validatedAdminResponse(
          ADMIN_METRICS_SCHEMA,
          metricsProjection(rows, range),
        ),
      );
    }),
  );

  app.get(
    '/admin/api/v1/audit-entries',
    authenticatedRoute((context) => {
      const url = new URL(context.req.url);
      const allowed = new Set([
        'cursor',
        'from',
        'kind',
        'limit',
        'outcome',
        'to',
      ]);
      if (
        [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
        [...allowed].some((key) => url.searchParams.getAll(key).length > 1)
      ) {
        return adminProblemResponse('invalid_request', 400);
      }
      const nowSeconds = Math.floor(now() / 1_000);
      const cursorValue = url.searchParams.get('cursor');
      const cursor =
        cursorValue === null ? undefined : parseCursor(cursorValue);
      if (
        cursorValue !== null &&
        (cursorValue.length > 2_048 ||
          cursor === undefined ||
          typeof cursor.expiresAt !== 'number' ||
          !Number.isSafeInteger(cursor.expiresAt) ||
          cursor.expiresAt <= nowSeconds ||
          typeof cursor.from !== 'number' ||
          !Number.isSafeInteger(cursor.from) ||
          typeof cursor.to !== 'number' ||
          !Number.isSafeInteger(cursor.to) ||
          typeof cursor.limit !== 'number' ||
          !Number.isSafeInteger(cursor.limit) ||
          (cursor.kind !== null && typeof cursor.kind !== 'string') ||
          (cursor.outcome !== null && typeof cursor.outcome !== 'string') ||
          typeof cursor.beforeAt !== 'number' ||
          !Number.isSafeInteger(cursor.beforeAt) ||
          typeof cursor.beforeId !== 'string' ||
          cursor.beforeId.length < 16 ||
          cursor.beforeId.length > 128)
      ) {
        return adminProblemResponse('invalid_request', 400);
      }
      const rawFrom = url.searchParams.get('from');
      const rawTo = url.searchParams.get('to');
      if ((rawFrom === null) !== (rawTo === null)) {
        return adminProblemResponse('invalid_request', 400);
      }
      const to =
        rawTo === null
          ? Number(cursor?.to ?? nowSeconds)
          : Math.floor(Date.parse(rawTo) / 1_000);
      const from =
        rawFrom === null
          ? Number(cursor?.from ?? to - 86_400)
          : Math.floor(Date.parse(rawFrom) / 1_000);
      const limit = Number(
        url.searchParams.get('limit') ?? cursor?.limit ?? '50',
      );
      const kind =
        url.searchParams.get('kind') ??
        (cursor?.kind === null
          ? undefined
          : (cursor?.kind as string | undefined));
      const outcome =
        url.searchParams.get('outcome') ??
        (cursor?.outcome === null
          ? undefined
          : (cursor?.outcome as string | undefined));
      const auditKinds = new Set<string>(ADMIN_AUDIT_KINDS);
      const auditOutcomes = new Set<string>(ADMIN_AUDIT_OUTCOMES);
      if (
        !Number.isSafeInteger(from) ||
        !Number.isSafeInteger(to) ||
        from < 0 ||
        to <= from ||
        to - from > 90 * 86_400 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        (kind !== undefined && !auditKinds.has(kind)) ||
        (outcome !== undefined && !auditOutcomes.has(outcome))
      ) {
        return adminProblemResponse('invalid_request', 400);
      }
      if (
        cursorValue !== null &&
        (cursor?.from !== from ||
          cursor.to !== to ||
          cursor.limit !== limit ||
          cursor.kind !== (kind ?? null) ||
          cursor.outcome !== (outcome ?? null) ||
          typeof cursor.beforeAt !== 'number' ||
          typeof cursor.beforeId !== 'string')
      ) {
        return adminProblemResponse('invalid_request', 400);
      }
      const entries = options.store.listAuditEntries({
        ...(cursor === undefined
          ? {}
          : {
              before: {
                id: String(cursor.beforeId),
                occurredAt: Number(cursor.beforeAt),
              },
            }),
        from,
        ...(kind === undefined
          ? {}
          : { kind: kind as (typeof ADMIN_AUDIT_KINDS)[number] }),
        limit,
        ...(outcome === undefined
          ? {}
          : { outcome: outcome as (typeof ADMIN_AUDIT_OUTCOMES)[number] }),
        to,
      });
      const page = entries.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        entries.length <= limit || last === undefined
          ? undefined
          : cursorFor({
              beforeAt: last.occurredAt,
              beforeId: last.id,
              expiresAt: nowSeconds + 15 * 60,
              from,
              kind: kind ?? null,
              limit,
              outcome: outcome ?? null,
              to,
            });
      return adminJsonResponse(
        validatedAdminResponse(ADMIN_AUDIT_PAGE_SCHEMA, {
          entries: page.map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            occurredAt: secondsToTimestamp(entry.occurredAt),
            operator:
              entry.issuer === null || entry.subject === null
                ? null
                : { issuer: entry.issuer, subject: entry.subject },
            outcome: entry.outcome,
            ...(entry.reason === null ? {} : { reason: entry.reason }),
          })),
          ...(nextCursor === undefined ? {} : { nextCursor }),
        }),
      );
    }),
  );

  app.get(
    '/admin/api/v1/backups',
    authenticatedRoute((context) =>
      new URL(context.req.url).search === ''
        ? adminJsonResponse(
            validatedAdminResponse(ADMIN_BACKUP_LIST_SCHEMA, {
              backups: options.store.listBackups().map(backupProjection),
            }),
          )
        : adminProblemResponse('invalid_request', 400),
    ),
  );

  app.post(
    '/admin/api/v1/backups',
    mutationRoute(async (context, session) => {
      if (!isEmptyMutation(context)) {
        return adminProblemResponse('invalid_request', 400);
      }
      if (options.operations === undefined) return adminUnavailableResponse();
      return operationProjection(
        await options.operations.backup(session.operator),
      );
    }),
  );

  app.post(
    '/admin/api/v1/operations/cleanup',
    mutationRoute(async (context, session) => {
      if (!isEmptyMutation(context)) {
        return adminProblemResponse('invalid_request', 400);
      }
      if (options.operations === undefined) return adminUnavailableResponse();
      return operationProjection(
        await options.operations.cleanup(session.operator),
      );
    }),
  );

  app.post(
    '/admin/api/v1/operations/firebase-validation',
    mutationRoute(async (context, session) => {
      if (!isEmptyMutation(context)) {
        return adminProblemResponse('invalid_request', 400);
      }
      if (options.operations === undefined) return adminUnavailableResponse();
      return operationProjection(
        await options.operations.firebaseValidation(session.operator),
      );
    }),
  );

  app.notFound((context) => {
    const staticResponse = options.assets.responseFor(context.req.raw);
    return staticResponse ?? adminNotFoundResponse();
  });
  app.onError(() => adminUnavailableResponse());

  return Object.freeze({
    cleanup: async (nowSeconds): Promise<void> => {
      const hour = Math.floor(nowSeconds / 3_600);
      const day = Math.floor(nowSeconds / 86_400);
      if (hour === lastCleanupHour) return;
      const includeRetention = day !== lastCleanupDay;
      await options.store.cleanup(
        nowSeconds,
        options.configuration.policy.auditRetentionDays * 86_400,
        options.configuration.policy.metricsRetentionDays * 86_400,
        includeRetention,
      );
      lastCleanupHour = hour;
      if (includeRetention) lastCleanupDay = day;
    },
    close(): void {
      options.store.close();
    },
    async fetch(request): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (
        (pathname.startsWith(API_PREFIX) || pathname.startsWith(AUTH_PREFIX)) &&
        request.method === 'HEAD'
      ) {
        return adminNotFoundResponse();
      }
      try {
        return await app.fetch(request);
      } catch {
        return adminUnavailableResponse();
      }
    },
    purgeSessions: (nowSeconds): Promise<number> =>
      options.store.purgeSessions(nowSeconds),
  });
}
