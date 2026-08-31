import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_SPA_ROUTES,
  loadAdminAssets,
} from '../../push-gateway/src/bun/admin/assets';

const UI_OUTPUT = fileURLToPath(
  new URL('../../../dist/apps/push-gateway-ui/browser/', import.meta.url),
);
const SESSION_PATH = '/admin/api/v1/session';
const SESSION = Object.freeze({
  id: 'browser_security_session',
  operator: {
    issuer: 'https://identity.example.test/',
    subject: 'browser-security-operator',
    displayName: 'Browser Security Operator',
    email: 'operator@example.test',
  },
  createdAt: '2026-01-01T00:00:00Z',
  lastSeenAt: '2026-01-01T00:00:00Z',
  idleExpiresAt: '2026-01-01T00:30:00Z',
  absoluteExpiresAt: '2026-01-01T08:00:00Z',
  current: true,
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
  columnNumber: number;
  disposition: string;
  effectiveDirective: string;
  lineNumber: number;
  sample: string;
  sourceFile: string;
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

let server: Server | undefined;
let origin = '';

test.beforeAll(async () => {
  const catalog = loadAdminAssets(path.resolve(UI_OUTPUT));
  server = createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? '/',
        `http://${request.headers.host ?? '127.0.0.1'}`,
      );
      let served: Response | undefined;

      if (request.method === 'GET' && requestUrl.pathname === SESSION_PATH) {
        served = new Response(JSON.stringify(SESSION), {
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
          },
        });
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
    throw new Error('Browser security server did not bind a TCP port.');
  }
  origin = `http://127.0.0.1:${String(address.port)}`;
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

test('loads every allowlisted route without CSP or Trusted Types violations', async ({
  browser,
}, testInfo) => {
  expect(ROUTES.map(({ path: routePath }) => routePath)).toEqual(
    ADMIN_SPA_ROUTES,
  );
  const documentNonces = new Set<string>();

  for (const route of ROUTES) {
    await test.step(route.path, async () => {
      const page = await browser.newPage();
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
            columnNumber: event.columnNumber,
            disposition: event.disposition,
            effectiveDirective: event.effectiveDirective,
            lineNumber: event.lineNumber,
            sample: event.sample,
            sourceFile: event.sourceFile,
            violatedDirective: event.violatedDirective,
          });
        });
      });

      try {
        const navigation = await page.goto(`${origin}${route.path}`, {
          waitUntil: 'domcontentloaded',
        });
        expect(navigation?.status()).toBe(200);
        await expect(
          page.getByRole('heading', { level: 1, name: route.heading }),
        ).toBeVisible();

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
            trustedTypesAvailable: 'trustedTypes' in globalThis,
            violations: securityState.__securityPolicyViolations ?? [],
          };
        });
        expect(documentSecurity.rootNonce).toBe(cspNonce);
        expect(documentSecurity.scriptNonces.length).toBeGreaterThan(0);
        expect(
          documentSecurity.scriptNonces.every((nonce) => nonce === cspNonce),
        ).toBe(true);
        expect(documentSecurity.violations).toEqual([]);
        if (testInfo.project.name === 'chromium') {
          expect(documentSecurity.trustedTypesAvailable).toBe(true);
        }
        expect(consoleErrors).toEqual([]);
        expect(pageErrors).toEqual([]);
        expect(requestFailures).toEqual([]);
        documentNonces.add(cspNonce ?? 'missing');

        if (
          testInfo.project.name === 'chromium' &&
          route.path === '/admin/security'
        ) {
          const screenshotPath = testInfo.outputPath('admin-security.png');
          await page.screenshot({ fullPage: true, path: screenshotPath });
          await testInfo.attach('admin-security', {
            contentType: 'image/png',
            path: screenshotPath,
          });
        }
      } finally {
        await page.close();
      }
    });
  }

  expect(documentNonces.size).toBe(ROUTES.length);
});
