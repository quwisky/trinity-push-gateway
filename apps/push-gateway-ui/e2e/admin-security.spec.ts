import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_SPA_ROUTES,
  loadAdminAssets,
} from '../../push-gateway/src/bun/admin/assets';
import {
  ADMIN_PROBLEM_CATALOG,
  AUDIT_QUERY_POLICY,
} from '../src/app/api/admin-contract.generated';
import type {
  Backup,
  OperatorSession,
} from '../src/app/api/generated/admin-api.schemas';

const UI_OUTPUT = fileURLToPath(
  new URL('../../../dist/apps/push-gateway-ui/browser/', import.meta.url),
);
const API_ROOT = '/admin/api/v1';
const XSRF_TOKEN = 'browser-acceptance-xsrf';
const SESSION = Object.freeze({
  id: 'browser_acceptance_session',
  operator: {
    issuer: 'https://identity.example.test/',
    subject: 'browser-acceptance-operator',
    displayName: 'Browser Acceptance Operator',
    email: 'operator@example.test',
  },
  createdAt: '2026-08-31T06:00:00Z',
  lastSeenAt: '2026-08-31T07:00:00Z',
  idleExpiresAt: '2026-08-31T07:30:00Z',
  absoluteExpiresAt: '2026-08-31T14:00:00Z',
  current: true,
});
const OTHER_SESSION = Object.freeze({
  ...SESSION,
  id: 'browser_acceptance_other_session',
  operator: {
    ...SESSION.operator,
    subject: 'other-operator',
    displayName: 'Other Operator Session',
    email: 'other@example.test',
  },
  createdAt: '2026-08-31T05:00:00Z',
  current: false,
});
const OVERVIEW = Object.freeze({
  observedAt: '2026-08-31T07:00:00Z',
  version: '0.8.0-test',
  uptimeSeconds: 93_784,
  gatewayReady: true,
  administrationReady: true,
  requestsLast24Hours: {
    processed: 18,
    invalid: 2,
    rateLimited: 1,
    safetyBudgetExhausted: 0,
    storageUnavailable: 0,
  },
  fcmAttemptsLast24Hours: {
    android: {
      attempted: 12,
      accepted: 10,
      permanentlyRejected: 1,
      transientFailure: 1,
    },
    ios: {
      attempted: 7,
      accepted: 6,
      permanentlyRejected: 0,
      transientFailure: 1,
    },
  },
  lastCleanup: {
    startedAt: '2026-08-31T06:45:00Z',
    completedAt: '2026-08-31T06:45:01Z',
    outcome: 'succeeded',
    cooldownEndsAt: '2026-08-31T06:50:01Z',
  },
  lastBackup: {
    startedAt: '2026-08-31T06:30:00Z',
    completedAt: '2026-08-31T06:30:02Z',
    outcome: 'succeeded',
    cooldownEndsAt: '2026-08-31T07:30:02Z',
  },
  lastFirebaseValidation: {
    startedAt: '2026-08-31T06:15:00Z',
    completedAt: '2026-08-31T06:15:01Z',
    outcome: 'succeeded',
    cooldownEndsAt: '2026-08-31T06:16:01Z',
  },
  databaseBytes: { gateway: 2_048_000, administration: 512_000 },
});
const HISTOGRAM = Object.freeze({
  under_100_ms: 4,
  '100_to_249_ms': 3,
  '250_to_499_ms': 2,
  '500_to_999_ms': 1,
  '1000_to_2499_ms': 0,
  '2500_to_4999_ms': 0,
  '5000_to_9999_ms': 0,
  '10000_ms_or_more': 0,
});
const METRICS = Object.freeze({
  from: '2026-08-31T05:00:00Z',
  to: '2026-08-31T07:00:00Z',
  interval: 'hour',
  requestBuckets: [
    {
      from: '2026-08-31T05:00:00Z',
      to: '2026-08-31T06:00:00Z',
      outcomes: {
        processed: 8,
        invalid: 1,
        rateLimited: 1,
        safetyBudgetExhausted: 0,
        storageUnavailable: 0,
      },
    },
    {
      from: '2026-08-31T06:00:00Z',
      to: '2026-08-31T07:00:00Z',
      outcomes: {
        processed: 10,
        invalid: 1,
        rateLimited: 0,
        safetyBudgetExhausted: 0,
        storageUnavailable: 0,
      },
    },
  ],
  fcmBuckets: ['2026-08-31T05:00:00Z', '2026-08-31T06:00:00Z'].flatMap(
    (from, index) => [
      {
        from,
        to: index === 0 ? '2026-08-31T06:00:00Z' : '2026-08-31T07:00:00Z',
        platform: 'android',
        outcomes: {
          attempted: 6,
          accepted: 5,
          permanentlyRejected: index,
          transientFailure: 1 - index,
        },
        latency: {
          sampleCount: 6,
          histogram: HISTOGRAM,
          approxP95Ms: 500,
        },
      },
      {
        from,
        to: index === 0 ? '2026-08-31T06:00:00Z' : '2026-08-31T07:00:00Z',
        platform: 'ios',
        outcomes: {
          attempted: 4,
          accepted: 3,
          permanentlyRejected: 0,
          transientFailure: 1,
        },
        latency: {
          sampleCount: 4,
          histogram: HISTOGRAM,
          approxP95Ms: index === 0 ? 1000 : null,
        },
      },
    ],
  ),
});
const CONFIGURATION = Object.freeze({
  observedAt: '2026-08-31T07:00:00Z',
  version: '0.8.0-test',
  gateway: {
    androidApplicationId: 'ovh.qwky.trinity.android',
    iosApplicationId: 'ovh.qwky.trinity.ios',
    firebaseProjectId: 'trinity-test',
    gatewayDatabasePath: '/private/gateway.sqlite',
    maxBodyBytes: 65_536,
    maxDailyAttempts: 20_000,
    maxClientInstallationsPerRequest: 49,
    pendingLeaseSeconds: 120,
    requestDeadlineSeconds: 30,
    terminalRetentionSeconds: 86_400,
    upstreamTimeoutSeconds: 10,
    sourceRateLimit: 300,
    sourceRatePeriodSeconds: 10,
    maxSourceKeys: 1000,
    cleanupIntervalSeconds: 3600,
  },
  administration: {
    enabled: true,
    publicOrigin: 'https://gateway.example.test',
    oidcIssuer: 'https://identity.example.test',
    oidcClientId: 'trinity-push-gateway',
    oidcScopes: ['openid', 'profile', 'email', 'groups'],
    oidcGroupClaim: 'groups',
    oidcRequiredGroup: 'push-gateway-operators',
    oidcTokenEndpointAuthMethod: 'client_secret_basic',
    administrationDatabasePath: '/private/admin.sqlite',
    backupDirectory: '/private/backups',
    sessionIdleSeconds: 1800,
    sessionAbsoluteSeconds: 28_800,
    maxSessionsPerIdentity: 5,
    maxSessionsDeployment: 100,
    metricsRetentionDays: 30,
    auditRetentionDays: 90,
    firebaseValidationDeadlineSeconds: 20,
    firebaseValidationCooldownSeconds: 60,
    cleanupDeadlineSeconds: 30,
    cleanupCooldownSeconds: 300,
    backupDeadlineSeconds: 120,
    backupCooldownSeconds: 3600,
    backupLimitCount: 100,
    backupLimitBytes: 1_073_741_824,
  },
  credentials: {
    firebaseClientEmail: { configured: true, source: 'file' },
    firebasePrivateKey: { configured: true, source: 'file' },
    firebaseProjectId: { configured: true, source: 'env' },
    fingerprintKey: { configured: true, source: 'env' },
    oidcClientSecret: { configured: true, source: 'env' },
    sessionSecret: { configured: true, source: 'env' },
  },
});
const BACKUP = Object.freeze({
  id: 'backup_identifier_1234',
  name: 'gateway-20260831T063002Z.sqlite',
  createdAt: '2026-08-31T06:30:02Z',
  sizeBytes: 2_048_000,
  sha256: 'a'.repeat(64),
  integrity: 'verified',
  operator: SESSION.operator,
});
const AUDIT_ENTRY = Object.freeze({
  id: 'audit_identifier_1234',
  occurredAt: '2026-08-31T06:45:01Z',
  operator: SESSION.operator,
  kind: 'cleanup',
  outcome: 'succeeded',
});

const ROUTES = Object.freeze([
  { path: '/admin/', heading: 'Overview' },
  { path: '/admin/sign-in', heading: 'Trinity Push Gateway' },
  { path: '/admin/overview', heading: 'Overview' },
  { path: '/admin/metrics', heading: 'Metrics' },
  { path: '/admin/operations', heading: 'Operations' },
  { path: '/admin/configuration', heading: 'Configuration' },
  { path: '/admin/security', heading: 'Security' },
] as const);

type RecordedViolation = Readonly<{
  blockedUri: string;
  effectiveDirective: string;
  violatedDirective: string;
}>;

const webHeaders = (headers: IncomingHttpHeaders): Headers => {
  const converted = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        converted.append(name, item);
      }
    } else if (value !== undefined) {
      converted.set(name, value);
    }
  }
  return converted;
};

const jsonResponse = (
  value: unknown,
  headers?: Readonly<Record<string, string>>,
): Response =>
  new Response(JSON.stringify(value), {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });

let server: Server | undefined;
let origin = '';
let sessions: OperatorSession[] = [SESSION, OTHER_SESSION];
let backups: Backup[] = [BACKUP];
let failOverviewRequests = 0;
let overviewDelayMilliseconds = 0;
let emptyMetricsRequests = 0;
let failedOperationRequests = 0;
let operationDelayMilliseconds = 0;
let mutationHeaders: IncomingHttpHeaders[] = [];

const resetServerState = (): void => {
  sessions = [SESSION, OTHER_SESSION];
  backups = [BACKUP];
  failOverviewRequests = 0;
  overviewDelayMilliseconds = 0;
  emptyMetricsRequests = 0;
  failedOperationRequests = 0;
  operationDelayMilliseconds = 0;
  mutationHeaders = [];
};

test.beforeAll(async () => {
  const catalog = loadAdminAssets(path.resolve(UI_OUTPUT));
  server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? '127.0.0.1'}`,
      );
      const { pathname, searchParams } = requestUrl;
      let served: Response | undefined;

      if (request.method === 'GET' && pathname === `${API_ROOT}/session`) {
        served = jsonResponse(SESSION, {
          'set-cookie': `TRINITY_ADMIN_XSRF=${XSRF_TOKEN}; Path=/admin; SameSite=Strict`,
        });
      } else if (
        request.method === 'GET' &&
        pathname === `${API_ROOT}/overview`
      ) {
        if (overviewDelayMilliseconds > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, overviewDelayMilliseconds),
          );
        }
        if (failOverviewRequests > 0) {
          failOverviewRequests -= 1;
          served = new Response(
            JSON.stringify({
              code: 'admin_unavailable',
              detail: 'Overview temporarily unavailable.',
              ...ADMIN_PROBLEM_CATALOG.admin_unavailable,
            }),
            {
              status: ADMIN_PROBLEM_CATALOG.admin_unavailable.status,
              headers: { 'content-type': 'application/problem+json' },
            },
          );
        } else {
          served = jsonResponse(OVERVIEW);
        }
      } else if (
        request.method === 'GET' &&
        pathname === `${API_ROOT}/metrics`
      ) {
        if (emptyMetricsRequests > 0) {
          emptyMetricsRequests -= 1;
          served = jsonResponse({
            ...METRICS,
            interval: searchParams.get('interval') ?? METRICS.interval,
            requestBuckets: [],
            fcmBuckets: [],
          });
        } else {
          served = jsonResponse({
            ...METRICS,
            interval: searchParams.get('interval') ?? METRICS.interval,
          });
        }
      } else if (
        request.method === 'GET' &&
        pathname === `${API_ROOT}/configuration`
      ) {
        served = jsonResponse(CONFIGURATION);
      } else if (
        request.method === 'GET' &&
        pathname === `${API_ROOT}/backups`
      ) {
        served = jsonResponse({ backups });
      } else if (
        request.method === 'GET' &&
        pathname === `${API_ROOT}/sessions`
      ) {
        served = jsonResponse({ sessions });
      } else if (
        request.method === 'GET' &&
        pathname === `${API_ROOT}/audit-entries`
      ) {
        served = searchParams.has('cursor')
          ? jsonResponse({
              entries: [
                {
                  ...AUDIT_ENTRY,
                  id: 'audit_identifier_older',
                  occurredAt: '2026-08-31T05:45:01Z',
                  kind: 'login',
                },
              ],
            })
          : jsonResponse({ entries: [AUDIT_ENTRY], nextCursor: 'next-page' });
      } else if (
        request.method === 'POST' &&
        (pathname === `${API_ROOT}/operations/firebase-validation` ||
          pathname === `${API_ROOT}/operations/cleanup`)
      ) {
        mutationHeaders.push(request.headers);
        if (operationDelayMilliseconds > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, operationDelayMilliseconds),
          );
        }
        if (failedOperationRequests > 0) {
          failedOperationRequests -= 1;
          served = new Response(
            JSON.stringify({
              code: 'cooldown_active',
              detail: 'Cooldown active; retry after the displayed boundary.',
              ...ADMIN_PROBLEM_CATALOG.cooldown_active,
            }),
            {
              status: ADMIN_PROBLEM_CATALOG.cooldown_active.status,
              headers: { 'content-type': 'application/problem+json' },
            },
          );
        } else {
          served = jsonResponse({
            startedAt: '2026-08-31T07:00:00Z',
            completedAt: '2026-08-31T07:00:01Z',
            outcome: 'succeeded',
            cooldownEndsAt: '2026-08-31T07:01:01Z',
          });
        }
      } else if (
        request.method === 'POST' &&
        pathname === `${API_ROOT}/backups`
      ) {
        mutationHeaders.push(request.headers);
        const created = {
          ...BACKUP,
          id: 'backup_identifier_created',
          name: 'gateway-20260831T070001Z.sqlite',
          createdAt: '2026-08-31T07:00:01Z',
        };
        backups = [created, ...backups];
        served = jsonResponse(created);
      } else if (
        request.method === 'DELETE' &&
        pathname.startsWith(`${API_ROOT}/sessions/`)
      ) {
        mutationHeaders.push(request.headers);
        const sessionId = decodeURIComponent(
          pathname.slice(pathname.lastIndexOf('/') + 1),
        );
        sessions = sessions.filter(({ id }) => id !== sessionId);
        served = new Response(null, { status: 204 });
      } else if (request.method === 'GET' && pathname === '/admin/auth/login') {
        served = new Response(null, {
          status: 302,
          headers: { location: '/admin/overview' },
        });
      } else if (
        request.method === 'POST' &&
        pathname === '/admin/auth/logout'
      ) {
        mutationHeaders.push(request.headers);
        served = new Response('', { status: 200 });
      } else {
        served = catalog.responseFor(
          new Request(requestUrl, {
            headers: webHeaders(request.headers),
            method: request.method,
          }),
        );
      }

      served ??= new Response('Not found', { status: 404 });
      response.statusCode = served.status;
      for (const [name, value] of served.headers) {
        response.setHeader(name, value);
      }
      if (request.method === 'HEAD' || served.body === null) {
        response.end();
        return;
      }
      response.end(Buffer.from(await served.arrayBuffer()));
    })().catch(() => {
      if (!response.headersSent) {
        response.writeHead(500, {
          'content-type': 'text/plain; charset=utf-8',
        });
      }
      response.end('Test server failure');
    });
  });

  const activeServer = server;
  await new Promise<void>((resolve, reject) => {
    activeServer.once('error', reject);
    activeServer.listen(0, '127.0.0.1', () => {
      activeServer.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Browser acceptance server did not bind a TCP port.');
  }
  origin = `http://127.0.0.1:${String(address.port)}`;
});

test.beforeEach(() => {
  resetServerState();
});

test.afterAll(async () => {
  if (server === undefined) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
});

test('loads every route with a fresh nonce, strict CSP, and no axe violations', async ({
  browser,
}) => {
  expect(ROUTES.map(({ path: routePath }) => routePath)).toEqual(
    ADMIN_SPA_ROUTES,
  );
  const documentNonces = new Set<string>();

  for (const route of ROUTES) {
    await test.step(route.path, async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const requestFailures: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('requestfailed', (request) => {
        requestFailures.push(
          `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'unknown error'}`,
        );
      });
      await page.addInitScript(() => {
        const securityState = globalThis as typeof globalThis & {
          __securityPolicyViolations?: RecordedViolation[];
        };
        securityState.__securityPolicyViolations = [];
        addEventListener('securitypolicyviolation', (event) => {
          securityState.__securityPolicyViolations?.push({
            blockedUri: event.blockedURI,
            effectiveDirective: event.effectiveDirective,
            violatedDirective: event.violatedDirective,
          });
        });
      });

      try {
        const navigation = await page.goto(`${origin}${route.path}`);
        expect(navigation?.status()).toBe(200);
        await expect(
          page.getByRole('heading', { level: 1, name: route.heading }),
        ).toBeVisible();
        if (route.heading === 'Overview' || route.heading === 'Metrics') {
          await expect(page.getByText(/Last updated/u)).toBeVisible();
        }
        await page.waitForLoadState('networkidle');

        const csp = navigation?.headers()['content-security-policy'];
        expect(csp).toContain("require-trusted-types-for 'script'");
        expect(csp).toContain('trusted-types angular angular#bundler');
        expect(csp).toContain("script-src-attr 'none'");
        const cspNonce = /script-src[^;]*'nonce-([A-Za-z0-9_-]{22})'/u.exec(
          csp ?? '',
        )?.[1];
        expect(cspNonce).toBeDefined();

        const documentSecurity = await page.evaluate(() => {
          const securityState = globalThis as typeof globalThis & {
            __securityPolicyViolations?: RecordedViolation[];
          };
          const scripts = Array.from(
            document.querySelectorAll<HTMLScriptElement>('script[src]'),
          );
          return {
            rootNonce:
              document.querySelector('tpg-root')?.getAttribute('ngcspnonce') ??
              null,
            scriptNonces: scripts.map((script) => script.nonce),
            violations: securityState.__securityPolicyViolations ?? [],
          };
        });
        expect(documentSecurity.rootNonce).toBe(cspNonce);
        expect(documentSecurity.scriptNonces.length).toBeGreaterThan(0);
        expect(
          documentSecurity.scriptNonces.every((nonce) => nonce === cspNonce),
        ).toBe(true);
        expect(documentSecurity.violations).toEqual([]);
        // Axe opens a helper tab to aggregate its results, intentionally
        // perturbing the application's visibility-driven polling lifecycle.
        expect(requestFailures).toEqual([]);

        const accessibility = await new AxeBuilder({ page }).analyze();
        expect(
          accessibility.violations,
          JSON.stringify(accessibility.violations, null, 2),
        ).toEqual([]);
        expect(consoleErrors).toEqual([]);
        expect(pageErrors).toEqual([]);
        documentNonces.add(cspNonce ?? 'missing');
      } finally {
        await context.close();
      }
    });
  }

  expect(documentNonces.size).toBe(ROUTES.length);
});

test('renders and operates all five feature routes', async ({
  page,
}, testInfo) => {
  await page.goto(`${origin}/admin/overview`);
  await expect(page.getByText('0.8.0-test')).toBeVisible();
  await expect(page.getByText('Gateway delivery')).toBeVisible();
  const overviewScreenshot = testInfo.outputPath('overview.png');
  await page.screenshot({ path: overviewScreenshot });
  await testInfo.attach('overview', {
    contentType: 'image/png',
    path: overviewScreenshot,
  });

  await page.getByRole('link', { name: 'Metrics' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Metrics' }),
  ).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(3);
  await expect(
    page.getByText('Notification Request outcomes by UTC interval'),
  ).toBeVisible();
  await page.evaluate(() => {
    scrollTo(0, 0);
  });
  const metricsScreenshot = testInfo.outputPath('metrics.png');
  await page.screenshot({ path: metricsScreenshot });
  await testInfo.attach('metrics', {
    contentType: 'image/png',
    path: metricsScreenshot,
  });
  const chartTableScreenshot = testInfo.outputPath('metrics-chart-table.png');
  await page
    .locator('section[aria-labelledby="request-outcomes-title"]')
    .screenshot({ path: chartTableScreenshot });
  await testInfo.attach('metrics-chart-and-table', {
    contentType: 'image/png',
    path: chartTableScreenshot,
  });
  await page.getByRole('combobox', { name: 'Interval' }).selectOption('day');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/admin/api/v1/metrics?') &&
        response.url().includes('interval=day'),
    ),
    page.getByRole('button', { name: 'Apply range' }).click(),
  ]);
  emptyMetricsRequests = 1;
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: 'No aggregate activity in this range',
    }),
  ).toBeVisible();
  const emptyMetricsAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    emptyMetricsAccessibility.violations,
    JSON.stringify(emptyMetricsAccessibility.violations, null, 2),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.getByRole('img')).toHaveCount(3);

  await page.getByRole('link', { name: 'Operations' }).click();
  await page.getByRole('button', { name: 'Validate Firebase access' }).click();
  const dialog = page.getByRole('alertdialog', {
    name: 'Validate Firebase access',
  });
  await expect(dialog).toBeVisible();
  const dialogAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    dialogAccessibility.violations,
    JSON.stringify(dialogAccessibility.violations, null, 2),
  ).toEqual([]);
  const operationScreenshot = testInfo.outputPath('operation-confirmation.png');
  await page.screenshot({ path: operationScreenshot });
  await testInfo.attach('operation-confirmation', {
    contentType: 'image/png',
    path: operationScreenshot,
  });
  const operationConfirmation = dialog.getByRole('checkbox');
  await operationConfirmation.click();
  await expect(operationConfirmation).toHaveAttribute('aria-checked', 'true');
  operationDelayMilliseconds = 300;
  await dialog.getByRole('button', { name: 'Confirm action' }).click();
  await expect(
    dialog.getByText('Validating Firebase access (up to 20 seconds)…'),
  ).toBeVisible();
  await expect(page.locator('.action-result')).toHaveText(
    'Firebase access validation succeeded.',
  );
  operationDelayMilliseconds = 0;

  failedOperationRequests = 1;
  await page.getByRole('button', { name: 'Run cleanup' }).click();
  const failedOperationDialog = page.getByRole('alertdialog', {
    name: 'Run gateway cleanup',
  });
  const failedOperationConfirmation =
    failedOperationDialog.getByRole('checkbox');
  await failedOperationConfirmation.click();
  await failedOperationDialog
    .getByRole('button', { name: 'Confirm action' })
    .click();
  await expect(
    failedOperationDialog.getByText(/Cooldown active/u),
  ).toBeVisible();
  const failedOperationAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    failedOperationAccessibility.violations,
    JSON.stringify(failedOperationAccessibility.violations, null, 2),
  ).toEqual([]);
  await failedOperationDialog.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Configuration' }).click();
  await expect(page.getByText('Administration enabled')).toBeVisible();
  await expect(page.getByText('true', { exact: true })).toBeVisible();
  await expect(page.getByText('ovh.qwky.trinity.android')).toBeVisible();
  await expect(page.getByText('Firebase client identity')).toBeVisible();
  await expect(page.getByText('/private/gateway.sqlite')).toBeVisible();
  await expect(page.getByText('/private/admin.sqlite')).toBeVisible();
  await expect(page.getByText('/private/backups')).toBeVisible();
  await expect(page.getByText('operator@example.test')).toHaveCount(0);
  const configurationScreenshot = testInfo.outputPath('configuration.png');
  await page.screenshot({ path: configurationScreenshot });
  await testInfo.attach('configuration', {
    contentType: 'image/png',
    path: configurationScreenshot,
  });

  await page.getByRole('link', { name: 'Security' }).click();
  await expect(
    page.getByText(
      `Maximum ${String(AUDIT_QUERY_POLICY.maximumRangeDays)} days`,
    ),
  ).toBeVisible();
  await expect(page.getByText('Other Operator Session')).toBeVisible();
  await page.getByRole('combobox', { name: 'Kind' }).selectOption('cleanup');
  await page
    .getByRole('combobox', { name: 'Outcome' })
    .selectOption('succeeded');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes('/admin/api/v1/audit-entries?') &&
        response.url().includes('kind=cleanup') &&
        response.url().includes('outcome=succeeded'),
    ),
    page.getByRole('button', { name: 'Apply audit filters' }).click(),
  ]);
  await page.getByRole('button', { name: 'Load older entries' }).click();
  await expect(
    page.getByRole('row', { name: /Login Succeeded/u }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Revoke session', exact: true })
    .click();
  const revocationDialog = page.getByRole('alertdialog', {
    name: 'Revoke Operator Session',
  });
  const revocationConfirmation = revocationDialog.getByRole('checkbox');
  await revocationConfirmation.click();
  await expect(revocationConfirmation).toHaveAttribute('aria-checked', 'true');
  await revocationDialog
    .getByRole('button', { name: 'Confirm action' })
    .click();
  await expect(page.getByText('Other Operator Session')).toHaveCount(0);
  const securityScreenshot = testInfo.outputPath('security.png');
  await page.screenshot({ path: securityScreenshot });
  await testInfo.attach('security', {
    contentType: 'image/png',
    path: securityScreenshot,
  });

  await page.getByRole('button', { name: 'Revoke this session' }).click();
  const currentSessionDialog = page.getByRole('alertdialog', {
    name: 'Revoke this Operator Session',
  });
  await currentSessionDialog.getByRole('checkbox').click();
  await currentSessionDialog
    .getByRole('button', { name: 'Confirm action' })
    .click();
  await expect(page).toHaveURL(/\/admin\/sign-in\?reason=unauthenticated$/u);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Trinity Push Gateway' }),
  ).toBeVisible();

  expect(mutationHeaders.length).toBeGreaterThanOrEqual(2);
  expect(
    mutationHeaders.every((headers) => headers['x-xsrf-token'] === XSRF_TOKEN),
  ).toBe(true);
});

test('preserves stale Overview data and recovers through Retry', async ({
  page,
}) => {
  await page.clock.install();
  overviewDelayMilliseconds = 300;
  failOverviewRequests = 1;
  await page.goto(`${origin}/admin/overview`);
  await expect(page.getByText('Loading overview…')).toBeVisible();
  await expect(
    page.getByText('Overview temporarily unavailable.'),
  ).toBeVisible();
  const errorAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    errorAccessibility.violations,
    JSON.stringify(errorAccessibility.violations, null, 2),
  ).toEqual([]);
  overviewDelayMilliseconds = 0;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('0.8.0-test')).toBeVisible();
  failOverviewRequests = 1;

  await page.clock.fastForward(30_000);
  await expect(
    page.getByText(/Showing the last successful overview/u),
  ).toBeVisible();
  await expect(page.getByText('0.8.0-test')).toBeVisible();
  const staleAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    staleAccessibility.violations,
    JSON.stringify(staleAccessibility.violations, null, 2),
  ).toEqual([]);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(
    page.getByText(/Showing the last successful overview/u),
  ).toHaveCount(0);
  await expect(page.getByText(/Last updated/u)).toBeVisible();
});

test('records 200 percent zoom, forced colors, reduced motion, and chart-table equivalence', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    forcedColors: 'active',
    reducedMotion: 'reduce',
    viewport: { width: 640, height: 450 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${origin}/admin/metrics`);
    await expect(page.getByRole('img')).toHaveCount(3);
    await expect(page.getByRole('table')).toHaveCount(3);
    expect(
      await page.evaluate(() => ({
        forcedColors: matchMedia('(forced-colors: active)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        reflowsAtEquivalentZoom:
          document.documentElement.scrollWidth <= globalThis.innerWidth,
      })),
    ).toEqual({
      forcedColors: true,
      reducedMotion: true,
      reflowsAtEquivalentZoom: true,
    });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations,
      JSON.stringify(accessibility.violations, null, 2),
    ).toEqual([]);

    const screenshotPath = testInfo.outputPath(
      'forced-colors-reduced-motion-200-percent.png',
    );
    await page.screenshot({ fullPage: true, path: screenshotPath });
    await testInfo.attach('accessibility-modes', {
      contentType: 'image/png',
      path: screenshotPath,
    });
  } finally {
    await context.close();
  }
});

test('supports login, keyboard navigation, focus, and logout @cross-browser', async ({
  page,
}) => {
  await page.goto(`${origin}/admin/sign-in`);
  await page.getByRole('link', { name: 'Continue to sign in' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Overview' }),
  ).toBeVisible();

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to main content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#main-content')).toBeFocused();

  const metricsLink = page.getByRole('link', { name: 'Metrics' });
  await metricsLink.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Metrics' }),
  ).toBeVisible();
  await expect(page.locator('main#main-content')).toBeFocused();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Trinity Push Gateway' }),
  ).toBeVisible();
});

test('keeps the responsive shell operable on mobile WebKit @mobile', async ({
  page,
}, testInfo) => {
  await page.goto(`${origin}/admin/overview`);
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: 'Configuration' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Configuration' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);

  const screenshotPath = testInfo.outputPath('mobile-configuration.png');
  await page.screenshot({ fullPage: true, path: screenshotPath });
  await testInfo.attach('mobile-configuration', {
    contentType: 'image/png',
    path: screenshotPath,
  });
});
