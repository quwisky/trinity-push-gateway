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
import type { BunConfiguration } from '../config';
import {
  createOidcAuthenticator,
  OidcAuthenticationError,
  type OidcAuthenticator,
} from '../auth/oidc-client';
import type { AdminAssetCatalog } from './assets';
import type { AdminConfiguration, SafeAdminConfiguration } from './config';
import {
  ADMIN_CONFIGURATION_RESPONSE_SCHEMA,
  ADMIN_OPERATOR_SESSION_LIST_SCHEMA,
  ADMIN_OPERATOR_SESSION_SCHEMA,
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
  const environment = options.gatewayConfiguration.environment;
  return {
    administration: options.safeConfiguration.administration,
    credentials: {
      firebaseClientEmail: {
        configured: true,
        source:
          options.gatewayConfiguration.credentialSources.firebaseClientEmail,
      },
      firebasePrivateKey: {
        configured: true,
        source:
          options.gatewayConfiguration.credentialSources.firebasePrivateKey,
      },
      firebaseProjectId: {
        configured: true,
        source:
          options.gatewayConfiguration.credentialSources.firebaseProjectId,
      },
      fingerprintKey: {
        configured: true,
        source: options.gatewayConfiguration.credentialSources.fingerprintKey,
      },
      oidcClientSecret: options.safeConfiguration.credentials.oidcClientSecret,
      sessionSecret: options.safeConfiguration.credentials.sessionSecret,
    },
    gateway: {
      androidApplicationId: environment.TRINITY_PUSH_GATEWAY_ANDROID_APP_ID,
      cleanupIntervalSeconds:
        options.gatewayConfiguration.cleanupIntervalSeconds,
      firebaseProjectId: environment.TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID,
      gatewayDatabasePath: options.gatewayConfiguration.databasePath,
      iosApplicationId: environment.TRINITY_PUSH_GATEWAY_IOS_APP_ID,
      maxBodyBytes: Number(environment.TRINITY_PUSH_GATEWAY_MAX_BODY_BYTES),
      maxClientInstallationsPerRequest: Number(
        environment.TRINITY_PUSH_GATEWAY_MAX_DEVICES,
      ),
      maxDailyAttempts: Number(
        environment.TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS,
      ),
      maxSourceKeys: options.gatewayConfiguration.maxSourceKeys,
      pendingLeaseSeconds: Number(
        environment.TRINITY_PUSH_GATEWAY_PENDING_LEASE_SECONDS,
      ),
      requestDeadlineSeconds: Number(
        environment.TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS,
      ),
      sourceRateLimit: options.gatewayConfiguration.sourceLimit,
      sourceRatePeriodSeconds: options.gatewayConfiguration.sourcePeriodSeconds,
      terminalRetentionSeconds: Number(
        environment.TRINITY_PUSH_GATEWAY_TERMINAL_RETENTION_SECONDS,
      ),
      upstreamTimeoutSeconds: Number(
        environment.TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS,
      ),
    },
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
          ADMIN_OPERATOR_SESSION_SCHEMA,
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
      const zeroOutcomes = {
        accepted: 0,
        attempted: 0,
        permanentlyRejected: 0,
        transientFailure: 0,
      };
      return adminJsonResponse(
        validatedAdminResponse(ADMIN_OVERVIEW_SCHEMA, {
          // Authentication immediately above proved the isolated store usable;
          // avoid running an integrity scan for every overview request.
          administrationReady: true,
          databaseBytes: {
            administration: safeFileSize(options.configuration.databasePath),
            gateway: safeFileSize(options.gatewayConfiguration.databasePath),
          },
          fcmAttemptsLast24Hours: {
            android: zeroOutcomes,
            ios: zeroOutcomes,
          },
          gatewayReady: options.gatewayReady(),
          observedAt: new Date(observedAtMs).toISOString(),
          requestsLast24Hours: {
            invalid: 0,
            processed: 0,
            rateLimited: 0,
            safetyBudgetExhausted: 0,
            storageUnavailable: 0,
          },
          uptimeSeconds: Math.max(
            0,
            Math.floor((observedAtMs - startedAt) / 1_000),
          ),
          version: gatewayVersion,
        }),
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
      await options.store.cleanup(nowSeconds);
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
