import { readFile } from 'node:fs/promises';

import { chromium } from '@playwright/test';

const statePath = process.argv[2];
if (!statePath) throw new Error('Browser state path is required.');
const state = JSON.parse(await readFile(statePath, 'utf8'));
const gatewayOrigin = 'http://127.0.0.1:3000';
const screenshotPath = process.env.PROVIDER_SCREENSHOT_PATH;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

async function authenticateProvider(page, context, identity) {
  if (state.provider === 'pocket-id') {
    const exchange = await context.request.post(
      `${state.providerOrigin}/api/one-time-access-token/${encodeURIComponent(identity.oneTimeToken)}`,
    );
    requireCondition(
      exchange.ok(),
      `Pocket ID token exchange returned ${exchange.status()}.`,
    );
    return;
  }

  await page.getByLabel('Username').waitFor({ state: 'visible' });
  await page.getByLabel('Username').fill(identity.username);
  const password = page.getByLabel('Password');
  if (!(await password.isVisible())) {
    await page.locator('button[type="submit"]').click();
    await password.waitFor({ state: 'visible' });
  }
  await password.fill(identity.password);
  await page.locator('button[type="submit"]').click();
}

async function login(browser, identity, allowed) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    if (state.provider === 'pocket-id') {
      await authenticateProvider(page, context, identity);
      await page.goto(`${gatewayOrigin}/admin/auth/login`);
    } else {
      await page.goto(`${gatewayOrigin}/admin/auth/login`);
      await authenticateProvider(page, context, identity);
    }
    await page.waitForURL((url) => url.origin === gatewayOrigin, {
      timeout: 60_000,
    });

    if (!allowed) {
      await page
        .getByRole('heading', { name: 'Trinity Push Gateway' })
        .waitFor();
      requireCondition(
        page.url().startsWith(`${gatewayOrigin}/admin/sign-in?reason=`),
        `Denied identity reached unexpected URL ${page.url()}.`,
      );
      const sessionStatus = await page.evaluate(
        async (origin) =>
          (await fetch(`${origin}/admin/api/v1/session`)).status,
        gatewayOrigin,
      );
      requireCondition(
        sessionStatus === 401,
        'Denied identity received a session.',
      );
      return;
    }

    await page.getByRole('heading', { name: 'Overview' }).waitFor();
    requireCondition(
      page.url() === `${gatewayOrigin}/admin/overview`,
      `Allowed identity did not reach overview: ${page.url()}.`,
    );
    const sessionStatus = await page.evaluate(
      async (origin) => (await fetch(`${origin}/admin/api/v1/session`)).status,
      gatewayOrigin,
    );
    requireCondition(
      sessionStatus === 200,
      `Session contract returned ${String(sessionStatus)}.`,
    );

    const external = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith('http') && url.origin !== gatewayOrigin) {
        external.push(request.url());
      }
    });
    await page.goto(`${gatewayOrigin}/admin/metrics`);
    await page.getByRole('heading', { name: 'Metrics' }).waitFor();
    requireCondition(
      external.length === 0,
      `Admin route made external requests: ${external.join(', ')}`,
    );
    if (screenshotPath) {
      await page.screenshot({ fullPage: true, path: screenshotPath });
    }

    const cookies = await context.cookies(gatewayOrigin);
    const xsrf = cookies.find(({ name }) => name === 'TRINITY_ADMIN_XSRF');
    requireCondition(xsrf !== undefined, 'XSRF cookie is missing.');
    await page.evaluate(
      async ({ origin, token }) => {
        await fetch(`${origin}/admin/auth/logout`, {
          headers: {
            'x-xsrf-token': token,
          },
          method: 'POST',
          redirect: 'manual',
        });
      },
      { origin: gatewayOrigin, token: xsrf.value },
    );
    const revokedStatus = await page.evaluate(
      async (origin) => (await fetch(`${origin}/admin/api/v1/session`)).status,
      gatewayOrigin,
    );
    requireCondition(revokedStatus === 401, 'Logout did not revoke locally.');
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await login(browser, state.allowed, true);
  await login(browser, state.denied, false);
  console.info(
    `${state.provider} assembled-image login, group rejection, local logout, deep-link, and no-external-request contracts passed.`,
  );
} finally {
  await browser.close();
}
