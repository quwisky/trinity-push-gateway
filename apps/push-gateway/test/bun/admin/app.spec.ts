import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { version as gatewayVersion } from '../../../../../package.json';
import { adminProblem } from '../../../src/admin-contract/operator-actions';
import {
  createAdminSurface,
  type AdminSurface,
} from '../../../src/bun/admin/app';
import { loadAdminAssets } from '../../../src/bun/admin/assets';
import { SqliteAdminStore } from '../../../src/bun/admin/store';
import { loadBunConfiguration } from '../../../src/bun/config';
import { readMigrations } from '../../../src/bun/migrations';
import {
  startTestOidcProvider,
  type TestOidcProvider,
  type TestProviderProfile,
} from '../auth/support/test-oidc-provider';
import { startMalformedLogoutProvider } from './malformed-logout-provider';

const PUBLIC_ORIGIN = 'http://127.0.0.1';
const SESSION_COOKIE = 'TRINITY_ADMIN_SESSION';
const XSRF_COOKIE = 'TRINITY_ADMIN_XSRF';
const OIDC_COOKIE = 'TRINITY_ADMIN_OIDC';
const SESSION_SECRET = 'session-secret-sentinel-00000000';
const ADMIN_MIGRATIONS_PATH = path.join(
  import.meta.dir,
  '../../../admin-migrations',
);
const ADMIN_MIGRATIONS = readMigrations(ADMIN_MIGRATIONS_PATH);
const directories: string[] = [];
const providers: TestOidcProvider[] = [];
const surfaces: AdminSurface[] = [];

type ProviderContract = Readonly<{
  clientSecretMethod: 'client_secret_basic' | 'client_secret_post';
  profile: TestProviderProfile;
  scopes: string;
}>;

type MutableClock = Readonly<{
  advance(milliseconds: number): void;
  now(): number;
}>;

type AdminHarness = Readonly<{
  clock: MutableClock;
  provider: TestOidcProvider;
  surface: AdminSurface;
}>;

type LoginStart = Readonly<{
  authorizationUrl: URL;
  callbackUrl: URL;
  oidcCookie: string;
  response: Response;
}>;

type BrowserSession = Readonly<{
  response: Response;
  sessionCookie: string;
  xsrfCookie: string;
}>;

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function createAssets(directory: string): void {
  writeFileSync(
    path.join(directory, 'index.html'),
    `<!doctype html>
<html lang="en"><head><base href="/admin/"><link rel="stylesheet" href="styles-ABCDEFGH.css"></head>
<body><tpg-root ngCspNonce="__TRINITY_ADMIN_CSP_NONCE__"></tpg-root><script nonce="__TRINITY_ADMIN_CSP_NONCE__" src="main-ABCDEFGH.js"></script></body></html>`,
  );
  writeFileSync(path.join(directory, 'main-ABCDEFGH.js'), 'export {};');
  writeFileSync(path.join(directory, 'styles-ABCDEFGH.css'), 'body{}');
}

function mutableClock(initial = 1_700_000_000_000): MutableClock {
  let current = initial;
  return {
    advance(milliseconds): void {
      current += milliseconds;
    },
    now: () => current,
  };
}

function cookieLine(response: Response, name: string): string | undefined {
  return response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${name}=`));
}

function cookieValue(response: Response, name: string): string | undefined {
  const line = cookieLine(response, name);
  if (line === undefined) {
    return undefined;
  }
  const value = line.slice(name.length + 1).split(';', 1)[0];
  return value === undefined || value.length === 0 ? undefined : value;
}

function cookies(...values: readonly [string, string][]): string {
  return values.map(([name, value]) => `${name}=${value}`).join('; ');
}

function expectClearedCookie(response: Response, name: string): void {
  const line = cookieLine(response, name);
  expect(line).toBeDefined();
  expect(line).toMatch(new RegExp(`^${name}=;`, 'u'));
  expect(line?.toLowerCase()).toContain('max-age=0');
}

function expectNoCors(response: Response): void {
  expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  expect(response.headers.get('access-control-allow-headers')).toBeNull();
  expect(response.headers.get('access-control-allow-methods')).toBeNull();
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
}

async function createHarness(
  contract: ProviderContract,
  mode: 'missing-group' | 'no-profile' | 'success' | 'wrong-group' = 'success',
  suppliedProvider?: TestOidcProvider,
): Promise<AdminHarness> {
  const provider =
    suppliedProvider ??
    (await startTestOidcProvider({
      clientSecretMethod: contract.clientSecretMethod,
      mode,
      profile: contract.profile,
    }));
  providers.push(provider);
  const directory = temporaryDirectory('trinity-admin-app-');
  const assetsPath = path.join(directory, 'assets');
  mkdirSync(assetsPath, { recursive: true });
  createAssets(assetsPath);
  const environment = {
    TRINITY_PUSH_GATEWAY_ADMIN_ASSETS_PATH: assetsPath,
    TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY: path.join(
      directory,
      'backups',
    ),
    TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: path.join(
      directory,
      'admin.sqlite',
    ),
    TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
    TRINITY_PUSH_GATEWAY_ADMIN_MIGRATIONS_PATH: ADMIN_MIGRATIONS_PATH,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: provider.clientId,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: provider.clientSecret,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: provider.issuer,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: 'gateway-operators',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: contract.scopes,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD:
      contract.clientSecretMethod,
    TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
    TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: SESSION_SECRET,
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
    TRINITY_PUSH_GATEWAY_DATABASE_PATH: path.join(directory, 'gateway.sqlite'),
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL:
      'firebase-client-email-sentinel@example.test',
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'firebase-private-key-sentinel',
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'firebase-project-sentinel',
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'fingerprint-key-sentinel-00000000',
    TRINITY_PUSH_GATEWAY_HOST: '127.0.0.1',
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
  } as const;
  const gatewayConfiguration = loadBunConfiguration(environment);
  const administration = gatewayConfiguration.administration;
  if (administration.kind !== 'enabled') {
    throw new Error('Test administration configuration is not enabled.');
  }
  const store = SqliteAdminStore.open(
    administration.configuration.databasePath,
    ADMIN_MIGRATIONS,
  );
  const clock = mutableClock();
  const surface = createAdminSurface({
    assets: loadAdminAssets(assetsPath, {
      nonce: () => 'AAAAAAAAAAAAAAAAAAAAAA',
    }),
    configuration: administration.configuration,
    gatewayConfiguration,
    gatewayReady: () => true,
    now: clock.now,
    operations: {
      async backup() {
        return { kind: 'limit' as const };
      },
      async cleanup() {
        return {
          kind: 'completed' as const,
          result: {
            completedAt: 1_700_000_001,
            cooldownEndsAt: 1_700_000_300,
            outcome: 'succeeded' as const,
            startedAt: 1_700_000_000,
          },
        };
      },
      async firebaseValidation() {
        return {
          kind: 'completed' as const,
          result: {
            completedAt: 1_700_000_001,
            cooldownEndsAt: 1_700_000_060,
            outcome: 'failed' as const,
            reason: 'access_denied',
            startedAt: 1_700_000_000,
          },
        };
      },
    },
    safeConfiguration: administration.safe,
    startedAt: clock.now() - 10_000,
    store,
  });
  surfaces.push(surface);
  return { clock, provider, surface };
}

async function beginLogin(harness: AdminHarness): Promise<LoginStart> {
  const response = await harness.surface.fetch(
    new Request(`${PUBLIC_ORIGIN}/admin/auth/login`),
  );
  const location = response.headers.get('location');
  const oidcCookie = cookieValue(response, OIDC_COOKIE);
  expect(response.status).toBe(303);
  expect(location).not.toBeNull();
  expect(oidcCookie).toBeDefined();
  if (location === null || oidcCookie === undefined) {
    throw new Error('Administration login did not start.');
  }
  const authorizationUrl = new URL(location);
  return {
    authorizationUrl,
    callbackUrl: await harness.provider.authorize(authorizationUrl),
    oidcCookie,
    response,
  };
}

async function completeLogin(
  harness: AdminHarness,
  start: LoginStart,
  oidcCookie = start.oidcCookie,
): Promise<Response> {
  return harness.surface.fetch(
    new Request(start.callbackUrl, {
      headers: { cookie: cookies([OIDC_COOKIE, oidcCookie]) },
    }),
  );
}

async function login(harness: AdminHarness): Promise<BrowserSession> {
  const response = await completeLogin(harness, await beginLogin(harness));
  const sessionCookie = cookieValue(response, SESSION_COOKIE);
  const xsrfCookie = cookieValue(response, XSRF_COOKIE);
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/admin/overview');
  expect(sessionCookie).toBeDefined();
  expect(xsrfCookie).toBeDefined();
  if (sessionCookie === undefined || xsrfCookie === undefined) {
    throw new Error('Administration login did not establish a session.');
  }
  return { response, sessionCookie, xsrfCookie };
}

function authenticatedRequest(
  pathname: string,
  session: BrowserSession,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookies([SESSION_COOKIE, session.sessionCookie]));
  return new Request(`${PUBLIC_ORIGIN}${pathname}`, { ...init, headers });
}

function mutationRequest(
  pathname: string,
  session: BrowserSession,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set(
    'cookie',
    cookies(
      [SESSION_COOKIE, session.sessionCookie],
      [XSRF_COOKIE, session.xsrfCookie],
    ),
  );
  headers.set('origin', PUBLIC_ORIGIN);
  headers.set('x-xsrf-token', session.xsrfCookie);
  return new Request(`${PUBLIC_ORIGIN}${pathname}`, { ...init, headers });
}

afterEach(async () => {
  for (const surface of surfaces.splice(0)) {
    surface.close();
  }
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('production administration HTTP surface', () => {
  it.each([
    [
      'Pocket ID',
      {
        clientSecretMethod: 'client_secret_basic',
        profile: 'pocket-id',
        scopes: 'openid profile email groups',
      },
    ],
    [
      'Authentik',
      {
        clientSecretMethod: 'client_secret_post',
        profile: 'authentik',
        scopes: 'openid profile email',
      },
    ],
  ] satisfies readonly [string, ProviderContract][])(
    'establishes a private Operator Session with %s',
    async (_name, contract) => {
      const harness = await createHarness(contract);
      const session = await login(harness);

      const oidcSetCookie = cookieLine(
        (await beginLogin(harness)).response,
        OIDC_COOKIE,
      );
      expect(oidcSetCookie).toMatch(/HttpOnly/iu);
      expect(oidcSetCookie).toMatch(/Path=\/admin\/auth\/callback/iu);
      expect(oidcSetCookie).toMatch(/SameSite=Lax/iu);
      expect(oidcSetCookie).toMatch(/Secure/iu);
      const sessionSetCookie = cookieLine(session.response, SESSION_COOKIE);
      expect(sessionSetCookie).toMatch(/HttpOnly/iu);
      expect(sessionSetCookie).toMatch(/Path=\//iu);
      expect(sessionSetCookie).toMatch(/SameSite=Strict/iu);
      expect(sessionSetCookie).toMatch(/Secure/iu);
      const xsrfSetCookie = cookieLine(session.response, XSRF_COOKIE);
      expect(xsrfSetCookie).toMatch(/Path=\/admin/iu);
      expect(xsrfSetCookie).toMatch(/SameSite=Strict/iu);
      expect(xsrfSetCookie).toMatch(/Secure/iu);
      expect(xsrfSetCookie).not.toMatch(/HttpOnly/iu);

      const response = await harness.surface.fetch(
        authenticatedRequest('/admin/api/v1/session', session),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        current: true,
        operator: {
          displayName: 'Gateway Operator',
          email: 'operator@example.test',
          issuer: harness.provider.issuer,
          subject: 'operator-123',
        },
      });
      expectNoCors(response);
    },
  );

  it('binds a one-use login attempt to the exact browser cookie', async () => {
    const harness = await createHarness({
      clientSecretMethod: 'client_secret_basic',
      profile: 'pocket-id',
      scopes: 'openid profile email groups',
    });
    const start = await beginLogin(harness);

    const wrongBrowser = await completeLogin(
      harness,
      start,
      'wrong-browser-cookie',
    );
    expect(wrongBrowser.status).toBe(303);
    expect(wrongBrowser.headers.get('location')).toBe(
      '/admin/sign-in?reason=unauthenticated',
    );
    expect(cookieValue(wrongBrowser, SESSION_COOKIE)).toBeUndefined();

    const correctBrowser = await completeLogin(harness, start);
    expect(correctBrowser.status).toBe(303);
    expect(correctBrowser.headers.get('location')).toBe('/admin/overview');
    expect(cookieValue(correctBrowser, SESSION_COOKIE)).toBeDefined();

    const replay = await completeLogin(harness, start);
    expect(replay.status).toBe(303);
    expect(replay.headers.get('location')).toBe(
      '/admin/sign-in?reason=unauthenticated',
    );
    expect(cookieValue(replay, SESSION_COOKIE)).toBeUndefined();
  });

  it.each([
    ['a missing group claim', 'missing-group'],
    ['the wrong group', 'wrong-group'],
  ] as const)(
    'rejects %s without establishing a session',
    async (_name, mode) => {
      const harness = await createHarness(
        {
          clientSecretMethod: 'client_secret_basic',
          profile: 'pocket-id',
          scopes: 'openid profile email groups',
        },
        mode,
      );

      const response = await completeLogin(harness, await beginLogin(harness));

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        '/admin/sign-in?reason=forbidden',
      );
      expect(cookieValue(response, SESSION_COOKIE)).toBeUndefined();
      expect(
        (
          await harness.surface.fetch(
            new Request(`${PUBLIC_ORIGIN}/admin/api/v1/session`),
          )
        ).status,
      ).toBe(401);
    },
  );

  it('maps an OIDC provider outage to an unavailable callback without state leakage', async () => {
    const harness = await createHarness({
      clientSecretMethod: 'client_secret_basic',
      profile: 'pocket-id',
      scopes: 'openid profile email groups',
    });
    const start = await beginLogin(harness);
    await harness.provider.close();

    const response = await completeLogin(harness, start);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      '/admin/sign-in?reason=unavailable',
    );
    expect(cookieValue(response, SESSION_COOKIE)).toBeUndefined();
    expect(cookieValue(response, XSRF_COOKIE)).toBeUndefined();
  });

  it('requires the exact Origin and XSRF token and revokes locally before provider logout', async () => {
    const harness = await createHarness({
      clientSecretMethod: 'client_secret_basic',
      profile: 'pocket-id',
      scopes: 'openid profile email groups',
    });
    const session = await login(harness);
    const cookie = cookies(
      [SESSION_COOKIE, session.sessionCookie],
      [XSRF_COOKIE, session.xsrfCookie],
    );

    const missingOrigin = await harness.surface.fetch(
      new Request(`${PUBLIC_ORIGIN}/admin/auth/logout`, {
        headers: { cookie, 'x-xsrf-token': session.xsrfCookie },
        method: 'POST',
      }),
    );
    expect(missingOrigin.status).toBe(403);
    const wrongOrigin = await harness.surface.fetch(
      new Request(`${PUBLIC_ORIGIN}/admin/auth/logout`, {
        headers: {
          cookie,
          origin: `${PUBLIC_ORIGIN}:1`,
          'x-xsrf-token': session.xsrfCookie,
        },
        method: 'POST',
      }),
    );
    expect(wrongOrigin.status).toBe(403);
    const wrongToken = await harness.surface.fetch(
      new Request(`${PUBLIC_ORIGIN}/admin/auth/logout`, {
        headers: {
          cookie,
          origin: PUBLIC_ORIGIN,
          'x-xsrf-token': 'wrong-xsrf-token',
        },
        method: 'POST',
      }),
    );
    expect(wrongToken.status).toBe(403);
    const forgedXsrf = 'forged-xsrf-token';
    const matchingForgery = await harness.surface.fetch(
      new Request(`${PUBLIC_ORIGIN}/admin/auth/logout`, {
        headers: {
          cookie: cookies(
            [SESSION_COOKIE, session.sessionCookie],
            [XSRF_COOKIE, forgedXsrf],
          ),
          origin: PUBLIC_ORIGIN,
          'x-xsrf-token': forgedXsrf,
        },
        method: 'POST',
      }),
    );
    expect(matchingForgery.status).toBe(403);
    expect(
      (
        await harness.surface.fetch(
          authenticatedRequest('/admin/api/v1/session', session),
        )
      ).status,
    ).toBe(200);

    await harness.provider.close();
    const logout = await harness.surface.fetch(
      mutationRequest('/admin/auth/logout', session, { method: 'POST' }),
    );
    expect(logout.status).toBe(303);
    expect(
      logout.headers
        .get('location')
        ?.startsWith(`${harness.provider.issuer}/session/end`),
    ).toBe(true);
    expectClearedCookie(logout, SESSION_COOKIE);
    expectClearedCookie(logout, XSRF_COOKIE);

    const afterLogout = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/session', session),
    );
    expect(afterLogout.status).toBe(401);
    expectClearedCookie(afterLogout, SESSION_COOKIE);
    expectClearedCookie(afterLogout, XSRF_COOKIE);
  });

  it('falls back locally when discovered provider logout metadata is malformed', async () => {
    const provider = await startMalformedLogoutProvider();
    const harness = await createHarness(
      {
        clientSecretMethod: 'client_secret_basic',
        profile: 'pocket-id',
        scopes: 'openid profile email groups',
      },
      'success',
      provider,
    );
    const session = await login(harness);

    const logout = await harness.surface.fetch(
      mutationRequest('/admin/auth/logout', session, { method: 'POST' }),
    );

    expect(logout.status).toBe(303);
    expect(logout.headers.get('location')).toBe(
      '/admin/sign-in?reason=unauthenticated',
    );
    expectClearedCookie(logout, SESSION_COOKIE);
    expectClearedCookie(logout, XSRF_COOKIE);
    const afterLogout = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/session', session),
    );
    expect(afterLogout.status).toBe(401);
  });

  it('expires idle sessions at the HTTP boundary and actively clears both cookies', async () => {
    const harness = await createHarness({
      clientSecretMethod: 'client_secret_basic',
      profile: 'pocket-id',
      scopes: 'openid profile email groups',
    });
    const session = await login(harness);
    harness.clock.advance(1_800_000);

    const response = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/session', session),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'unauthenticated' });
    expectClearedCookie(response, SESSION_COOKIE);
    expectClearedCookie(response, XSRF_COOKIE);
  });

  it('enforces the identity cap and exposes bounded cross-session revocation', async () => {
    const harness = await createHarness({
      clientSecretMethod: 'client_secret_basic',
      profile: 'pocket-id',
      scopes: 'openid profile email groups',
    });
    const sessions: BrowserSession[] = [];
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const session = await login(harness);
      sessions.push(session);
      const response = await harness.surface.fetch(
        authenticatedRequest('/admin/api/v1/session', session),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { readonly id: string };
      ids.push(body.id);
      harness.clock.advance(1_000);
    }
    const first = sessions[0];
    const second = sessions[1];
    const newest = sessions[5];
    if (first === undefined || second === undefined || newest === undefined) {
      throw new Error('Expected six test sessions.');
    }

    const evicted = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/session', first),
    );
    expect(evicted.status).toBe(401);
    const list = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/sessions', newest),
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      readonly sessions: readonly { readonly id: string }[];
    };
    expect(listed.sessions).toHaveLength(5);
    expect(listed.sessions.map(({ id }) => id)).not.toContain(ids[0]);

    const revoke = await harness.surface.fetch(
      mutationRequest(`/admin/api/v1/sessions/${ids[1]}`, newest, {
        method: 'DELETE',
      }),
    );
    expect(revoke.status).toBe(204);
    expectNoCors(revoke);
    expect(
      (
        await harness.surface.fetch(
          authenticatedRequest('/admin/api/v1/session', second),
        )
      ).status,
    ).toBe(401);

    const newestId = ids[5];
    if (newestId === undefined) {
      throw new Error('Newest session ID is missing.');
    }
    const selfRevoke = await harness.surface.fetch(
      mutationRequest(`/admin/api/v1/sessions/${newestId}`, newest, {
        method: 'DELETE',
      }),
    );
    expect(selfRevoke.status).toBe(204);
    expectClearedCookie(selfRevoke, SESSION_COOKIE);
    expectClearedCookie(selfRevoke, XSRF_COOKIE);
  });

  it('returns only safe configuration and an exact route surface without CORS', async () => {
    const harness = await createHarness({
      clientSecretMethod: 'client_secret_basic',
      profile: 'pocket-id',
      scopes: 'openid profile email groups',
    });
    const session = await login(harness);

    const currentSession = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/session', session),
    );
    expect(currentSession.status).toBe(200);
    const currentSessionBody: unknown = await currentSession.json();
    const overview = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/overview', session),
    );
    expect(overview.status).toBe(200);
    const overviewBody: unknown = await overview.json();
    expect(overviewBody).toMatchObject({
      administrationReady: true,
      databaseBytes: { gateway: 0 },
      fcmAttemptsLast24Hours: {
        android: {
          accepted: 0,
          attempted: 0,
          permanentlyRejected: 0,
          transientFailure: 0,
        },
        ios: {
          accepted: 0,
          attempted: 0,
          permanentlyRejected: 0,
          transientFailure: 0,
        },
      },
      gatewayReady: true,
      observedAt: '2023-11-14T22:13:20.000Z',
      requestsLast24Hours: {
        invalid: 0,
        processed: 0,
        rateLimited: 0,
        safetyBudgetExhausted: 0,
        storageUnavailable: 0,
      },
      uptimeSeconds: 10,
      version: gatewayVersion,
    });
    expect(
      (
        overviewBody as {
          readonly databaseBytes?: { readonly administration?: number };
        }
      ).databaseBytes?.administration,
    ).toBeGreaterThan(0);
    expectNoCors(overview);
    const metrics = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/metrics', session),
    );
    expect(metrics.status).toBe(200);
    expect(await metrics.json()).toMatchObject({
      fcmBuckets: [],
      interval: 'hour',
      requestBuckets: [],
    });
    harness.clock.advance(1_000);
    const audit = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/audit-entries?limit=1', session),
    );
    expect(audit.status).toBe(200);
    expect(await audit.json()).toMatchObject({
      entries: [{ kind: 'login', outcome: 'succeeded' }],
    });
    const backups = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/backups', session),
    );
    expect(backups.status).toBe(200);
    expect(await backups.json()).toEqual({ backups: [] });
    const cleanup = await harness.surface.fetch(
      mutationRequest('/admin/api/v1/operations/cleanup', session, {
        method: 'POST',
      }),
    );
    expect(cleanup.status).toBe(200);
    expect(await cleanup.json()).toMatchObject({
      outcome: 'succeeded',
    });
    const invalidMetrics = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/metrics?label=secret', session),
    );
    expect(invalidMetrics.status).toBe(400);
    expect(await invalidMetrics.json()).toEqual(
      adminProblem('invalid_request'),
    );
    const invalidActionRequests = [
      authenticatedRequest('/admin/api/v1/backups?unexpected=true', session),
      mutationRequest('/admin/api/v1/backups?unexpected=true', session, {
        method: 'POST',
      }),
      mutationRequest('/admin/api/v1/operations/cleanup', session, {
        body: '{}',
        method: 'POST',
      }),
      mutationRequest('/admin/api/v1/operations/firebase-validation', session, {
        body: '{}',
        method: 'POST',
      }),
    ];
    for (const request of invalidActionRequests) {
      const response = await harness.surface.fetch(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(adminProblem('invalid_request'));
    }
    const projections = JSON.stringify({
      overview: overviewBody,
      session: currentSessionBody,
    });
    for (const forbidden of [
      session.sessionCookie,
      session.xsrfCookie,
      harness.provider.clientSecret,
      'access_token',
      'id_token',
      'refresh_token',
      'registration-token',
      'account-route',
      '$event:example.test',
      '!room:example.test',
    ]) {
      expect(projections).not.toContain(forbidden);
    }

    const configuration = await harness.surface.fetch(
      authenticatedRequest('/admin/api/v1/configuration', session),
    );
    expect(configuration.status).toBe(200);
    const body: unknown = await configuration.json();
    expect(body).toMatchObject({
      credentials: {
        firebaseClientEmail: { configured: true, source: 'env' },
        firebasePrivateKey: { configured: true, source: 'env' },
        firebaseProjectId: { configured: true, source: 'env' },
        fingerprintKey: { configured: true, source: 'env' },
        oidcClientSecret: { configured: true, source: 'env' },
        sessionSecret: { configured: true, source: 'env' },
      },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(harness.provider.clientSecret);
    expect(serialized).not.toContain(SESSION_SECRET);
    expect(serialized).not.toContain(
      'firebase-client-email-sentinel@example.test',
    );
    expect(serialized).not.toContain('firebase-private-key-sentinel');
    expect(serialized).not.toContain('fingerprint-key-sentinel');
    expect(serialized).not.toContain('/assets');
    expect(serialized).not.toContain('/admin-migrations');
    expectNoCors(configuration);

    const unauthenticated = await harness.surface.fetch(
      new Request(`${PUBLIC_ORIGIN}/admin/api/v1/session`),
    );
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get('content-type')).toBe(
      'application/problem+json; charset=utf-8',
    );
    const unauthenticatedBody = await unauthenticated.text();
    expect(JSON.parse(unauthenticatedBody)).toEqual({
      code: 'unauthenticated',
      status: 401,
      title: 'Authentication required',
      type: '/admin/problems/unauthenticated',
    });
    expect(unauthenticatedBody).not.toContain('<html');
    expectNoCors(unauthenticated);

    const routes = [
      ['GET', '/admin/', 200],
      ['HEAD', '/admin/', 200],
      ['GET', '/admin/main-ABCDEFGH.js', 200],
      ['HEAD', '/admin/main-ABCDEFGH.js', 200],
      ['GET', '/admin', 404],
      ['POST', '/admin/overview', 404],
      ['GET', '/admin/unknown', 404],
      ['GET', '/admin/api/v1/unknown', 404],
      ['GET', '/admin/api/v1/session/', 404],
      ['HEAD', '/admin/api/v1/session', 404],
      ['OPTIONS', '/admin/api/v1/session', 404],
      ['GET', '/admin/auth/unknown', 404],
      ['POST', '/admin/auth/login', 404],
      ['HEAD', '/admin/auth/login', 404],
    ] as const;
    for (const [method, pathname, status] of routes) {
      const response = await harness.surface.fetch(
        new Request(`${PUBLIC_ORIGIN}${pathname}`, { method }),
      );
      expect(response.status).toBe(status);
      expectNoCors(response);
    }
  });
});
