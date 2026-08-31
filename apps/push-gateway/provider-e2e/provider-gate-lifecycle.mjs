import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const GATEWAY_ORIGIN = 'http://127.0.0.1:3000';
const DISCOVERY_SUFFIX = '/.well-known/openid-configuration';
const WAIT_ATTEMPTS = 90;
const WORKSPACE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function normalizedRunId(value) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/gu, '-');
  const bounded = normalized.replace(/^-+|-+$/gu, '').slice(0, 32);
  if (bounded.length === 0) {
    throw new Error('Provider gate run ID must contain a letter or number.');
  }
  return bounded;
}

function validateOwnedDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const forbidden = new Set([
    path.parse(resolved).root,
    path.resolve(process.cwd()),
    path.resolve(os.homedir()),
    path.resolve(os.tmpdir()),
    path.resolve(WORKSPACE_ROOT),
  ]);
  if (forbidden.has(resolved)) {
    throw new Error(`${label} must be a dedicated child directory.`);
  }
  return resolved;
}

function containsDirectory(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export function providerGateConfiguration(adapter, environment = process.env) {
  const runId = normalizedRunId(
    environment.PROVIDER_GATE_RUN_ID ?? `${Date.now()}-${process.pid}`,
  );
  const workDirectory = validateOwnedDirectory(
    environment.PROVIDER_GATE_WORK_DIRECTORY ??
      path.join(os.tmpdir(), `trinity-${adapter.id}-${runId}`),
    'Provider gate work directory',
  );
  const evidenceDirectory = validateOwnedDirectory(
    environment.PROVIDER_GATE_EVIDENCE_DIRECTORY ??
      path.join(
        WORKSPACE_ROOT,
        'test-output',
        'provider-gates',
        `${adapter.id}-${runId}`,
      ),
    'Provider gate evidence directory',
  );
  if (
    containsDirectory(workDirectory, evidenceDirectory) ||
    containsDirectory(evidenceDirectory, workDirectory)
  ) {
    throw new Error(
      'Provider credentials and evidence must use separate directory trees.',
    );
  }
  const resourcePrefix = `tpg-${adapter.id}-${runId}`;
  return Object.freeze({
    containerName: `${resourcePrefix}-gateway`,
    evidenceDirectory,
    gatewayEnvironmentPath: path.join(workDirectory, 'gateway.env'),
    gatewayImage:
      environment.PROVIDER_GATE_IMAGE ?? 'trinity-push-gateway:provider-gate',
    gatewayOrigin: GATEWAY_ORIGIN,
    gatewayVolume: `${resourcePrefix}-data`,
    projectName: resourcePrefix,
    providerEnvironmentPath: path.join(workDirectory, 'provider.env'),
    providerId: adapter.id,
    runId,
    screenshotPath: path.join(evidenceDirectory, `${adapter.id}-metrics.png`),
    workDirectory,
  });
}

function formatEnvironment(environment) {
  return `${Object.entries(environment)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')}\n`;
}

function maskSecret(value, environment) {
  if (environment.GITHUB_ACTIONS === 'true') {
    console.info(`::add-mask::${value}`);
  }
}

function gatewayEnvironment(adapter, providerSecrets, sessionSecret) {
  return Object.freeze({
    TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY: '/data/backups',
    TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: '/data/admin.sqlite',
    TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: adapter.clientId,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: providerSecrets.clientSecret,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM: 'groups',
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: adapter.issuer,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: adapter.requiredGroup,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES: adapter.scopes,
    TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD:
      adapter.tokenEndpointAuthMethod,
    TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: GATEWAY_ORIGIN,
    TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: sessionSecret,
    TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
    TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
    TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'test-private-key',
    TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'example-project',
    TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'test-fingerprint-key-32-bytes-long',
    TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
  });
}

async function prepareCredentials(
  adapter,
  configuration,
  environment,
  secretFactory,
) {
  await rm(configuration.workDirectory, { force: true, recursive: true });
  await mkdir(configuration.workDirectory, { mode: 0o700, recursive: true });
  const providerSecrets = adapter.createProviderSecrets(secretFactory);
  const providerEnvironment = adapter.providerEnvironment(providerSecrets);
  const sessionSecret = secretFactory(36);
  for (const value of [...Object.values(providerEnvironment), sessionSecret]) {
    maskSecret(value, environment);
  }
  await Promise.all([
    writeFile(
      configuration.providerEnvironmentPath,
      formatEnvironment(providerEnvironment),
      { mode: 0o600 },
    ),
    writeFile(
      configuration.gatewayEnvironmentPath,
      formatEnvironment(
        gatewayEnvironment(adapter, providerSecrets, sessionSecret),
      ),
      { mode: 0o600 },
    ),
  ]);
  return providerSecrets;
}

export async function runProcess(command, arguments_, options = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, arguments_, {
      env: options.environment ?? process.env,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve({ stderr, stdout });
        return;
      }
      reject(
        new Error(
          `${command} exited ${signal === null ? `with code ${String(code)}` : `from signal ${signal}`}.`,
        ),
      );
    });
  });
}

async function waitFor(label, operation, sleep) {
  let lastError;
  for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt += 1) {
    try {
      if (await operation()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < WAIT_ATTEMPTS) {
      await sleep(1_000);
    }
  }
  throw new Error(
    `${label} did not become ready.${lastError ? ' Last check failed.' : ''}`,
  );
}

async function waitForProvider(adapter, fetchImplementation, sleep) {
  let providerMetadata;
  await waitFor(
    adapter.displayName,
    async () => {
      const response = await fetchImplementation(
        `${adapter.issuer}${DISCOVERY_SUFFIX}`,
        {
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (!response.ok) {
        return false;
      }
      const discovery = await response.json();
      const valid =
        discovery.issuer === adapter.issuer &&
        [
          'authorization_endpoint',
          'token_endpoint',
          'jwks_uri',
          'end_session_endpoint',
        ].every(
          (name) =>
            typeof discovery[name] === 'string' && discovery[name].length > 0,
        );
      if (valid) {
        providerMetadata = discovery;
      }
      return valid;
    },
    sleep,
  );
  return providerMetadata;
}

async function waitForGateway(configuration, fetchImplementation, sleep) {
  await waitFor(
    'Assembled gateway',
    async () => {
      const response = await fetchImplementation(
        `${configuration.gatewayOrigin}/admin/`,
        {
          redirect: 'manual',
          signal: AbortSignal.timeout(3_000),
        },
      );
      return response.status === 200;
    },
    sleep,
  );
}

async function waitForProviderOutage(adapter, fetchImplementation, sleep) {
  await waitFor(
    `${adapter.displayName} outage`,
    async () => {
      try {
        await fetchImplementation(`${adapter.issuer}${DISCOVERY_SUFFIX}`, {
          signal: AbortSignal.timeout(1_000),
        });
        return false;
      } catch {
        return true;
      }
    },
    sleep,
  );
}

async function sessionStatus(page, gatewayOrigin) {
  return page.evaluate(
    async (origin) => (await fetch(`${origin}/admin/api/v1/session`)).status,
    gatewayOrigin,
  );
}

async function exerciseAllowedBrowser(
  adapter,
  browser,
  identities,
  configuration,
  providerMetadata,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await adapter.authenticate({ context, identity: identities.allowed, page });
    await page.goto(`${configuration.gatewayOrigin}/admin/metrics`);
    await page.getByRole('heading', { name: 'Trinity Push Gateway' }).waitFor();
    const signInUrl = new URL(page.url());
    requireCondition(
      signInUrl.pathname === '/admin/sign-in' &&
        signInUrl.searchParams.get('reason') === 'unauthenticated' &&
        signInUrl.searchParams.get('returnPath') === '/admin/metrics',
      `Unauthenticated deep link reached unexpected URL ${page.url()}.`,
    );
    const continueLink = page.getByRole('link', {
      name: 'Continue to sign in',
    });
    requireCondition(
      (await continueLink.getAttribute('href')) ===
        '/admin/auth/login?returnPath=%2Fadmin%2Fmetrics',
      'The sign-in page did not preserve the administration deep link.',
    );
    await continueLink.click();
    await page.waitForURL(
      (url) =>
        url.origin === configuration.gatewayOrigin &&
        url.pathname === '/admin/metrics',
      { timeout: 60_000 },
    );
    await page.getByRole('heading', { name: 'Metrics' }).waitFor();
    requireCondition(
      (await sessionStatus(page, configuration.gatewayOrigin)) === 200,
      'Allowed identity did not receive an Operator Session.',
    );

    const externalRequests = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        url.protocol.startsWith('http') &&
        url.origin !== configuration.gatewayOrigin
      ) {
        externalRequests.push(request.url());
      }
    });
    await page.reload();
    await page.getByRole('heading', { name: 'Metrics' }).waitFor();
    requireCondition(
      externalRequests.length === 0,
      `Authenticated administration route made external requests: ${externalRequests.join(', ')}.`,
    );
    await page.screenshot({
      fullPage: true,
      path: configuration.screenshotPath,
    });

    const xsrfToken = await page.evaluate(() =>
      document.cookie
        .split('; ')
        .find((cookie) => cookie.startsWith('TRINITY_ADMIN_XSRF='))
        ?.slice('TRINITY_ADMIN_XSRF='.length),
    );
    requireCondition(xsrfToken !== undefined, 'XSRF cookie is missing.');
    const expectedLogoutUrl = new URL(providerMetadata.end_session_endpoint);
    expectedLogoutUrl.searchParams.set('client_id', adapter.clientId);
    const [logoutResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url() ===
            `${configuration.gatewayOrigin}/admin/auth/logout` &&
          response.request().method() === 'POST',
      ),
      page.evaluate(
        async ({ origin, token }) => {
          await fetch(`${origin}/admin/auth/logout`, {
            headers: { 'x-xsrf-token': token },
            method: 'POST',
            redirect: 'manual',
          });
        },
        { origin: configuration.gatewayOrigin, token: xsrfToken },
      ),
    ]);
    requireCondition(
      logoutResponse.status() === 303,
      `Logout returned ${String(logoutResponse.status())} instead of a redirect.`,
    );
    requireCondition(
      logoutResponse.headers().location === expectedLogoutUrl.href,
      'Logout returned an unexpected provider URL.',
    );
    requireCondition(
      (await sessionStatus(page, configuration.gatewayOrigin)) === 401,
      'Logout did not revoke the Operator Session locally.',
    );
    const [providerLogoutResponse] = await Promise.all([
      page.waitForResponse(
        (response) => response.url() === expectedLogoutUrl.href,
      ),
      page.goto(expectedLogoutUrl.href),
    ]);
    requireCondition(
      providerLogoutResponse.status() >= 200 &&
        providerLogoutResponse.status() < 400,
      `Provider logout returned ${String(providerLogoutResponse.status())}.`,
    );
  } finally {
    await context.close();
  }
}

async function exerciseDeniedBrowser(
  adapter,
  browser,
  identities,
  configuration,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await adapter.authenticate({ context, identity: identities.denied, page });
    const loginUrl = new URL('/admin/auth/login', configuration.gatewayOrigin);
    loginUrl.searchParams.set('returnPath', '/admin/security');
    await page.goto(loginUrl.href);
    await page.waitForURL(
      (url) =>
        url.origin === configuration.gatewayOrigin ||
        adapter.isDeniedProviderUrl(url),
      { timeout: 60_000 },
    );
    if (adapter.isDeniedProviderUrl(new URL(page.url()))) {
      await adapter.normalizeDeniedPage(page, configuration.gatewayOrigin);
    }
    await page.getByRole('heading', { name: 'Trinity Push Gateway' }).waitFor();
    const denialUrl = new URL(page.url());
    requireCondition(
      denialUrl.pathname === '/admin/sign-in' &&
        denialUrl.searchParams.get('reason') === 'forbidden',
      `Denied identity reached unexpected URL ${page.url()}.`,
    );
    requireCondition(
      (await sessionStatus(page, configuration.gatewayOrigin)) === 401,
      'Denied identity received an Operator Session.',
    );
  } finally {
    await context.close();
  }
}

export async function runBrowserContracts(
  adapter,
  identities,
  configuration,
  providerMetadata,
  browserType = chromium,
) {
  const browser = await browserType.launch({ headless: true });
  try {
    await exerciseAllowedBrowser(
      adapter,
      browser,
      identities,
      configuration,
      providerMetadata,
    );
    await exerciseDeniedBrowser(adapter, browser, identities, configuration);
  } finally {
    await browser.close();
  }
}

async function cleanResources(adapter, configuration, processRunner) {
  const errors = [];
  const attempt = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      errors.push(error);
      return undefined;
    }
  };
  const captured = async (arguments_) => {
    const result = await processRunner('docker', arguments_, { capture: true });
    return result?.stdout.trim() ?? '';
  };
  const gatewayContainers = await attempt(() =>
    captured([
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `name=^/${configuration.containerName}$`,
    ]),
  );
  if (gatewayContainers === undefined || gatewayContainers !== '') {
    await attempt(() =>
      processRunner('docker', ['rm', '--force', configuration.containerName]),
    );
  }
  const gatewayVolumes = await attempt(() =>
    captured([
      'volume',
      'ls',
      '--quiet',
      '--filter',
      `name=^${configuration.gatewayVolume}$`,
    ]),
  );
  if (gatewayVolumes === undefined || gatewayVolumes !== '') {
    await attempt(() =>
      processRunner('docker', ['volume', 'rm', configuration.gatewayVolume]),
    );
  }
  await attempt(() =>
    processRunner(
      'docker',
      [
        'compose',
        '--project-name',
        configuration.projectName,
        '--env-file',
        configuration.providerEnvironmentPath,
        '--file',
        adapter.composeFile,
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      { capture: true },
    ),
  );
  const remaining = await Promise.all([
    attempt(() =>
      captured([
        'container',
        'ls',
        '--all',
        '--quiet',
        '--filter',
        `label=com.docker.compose.project=${configuration.projectName}`,
      ]),
    ),
    attempt(() =>
      captured([
        'network',
        'ls',
        '--quiet',
        '--filter',
        `label=com.docker.compose.project=${configuration.projectName}`,
      ]),
    ),
    attempt(() =>
      captured([
        'volume',
        'ls',
        '--quiet',
        '--filter',
        `label=com.docker.compose.project=${configuration.projectName}`,
      ]),
    ),
    attempt(() =>
      captured([
        'container',
        'ls',
        '--all',
        '--quiet',
        '--filter',
        `name=^/${configuration.containerName}$`,
      ]),
    ),
    attempt(() =>
      captured([
        'volume',
        'ls',
        '--quiet',
        '--filter',
        `name=^${configuration.gatewayVolume}$`,
      ]),
    ),
  ]);
  if (
    errors.length > 0 ||
    remaining.some(
      (resourceIds) => resourceIds === undefined || resourceIds !== '',
    )
  ) {
    throw new AggregateError(
      errors,
      'Provider gate cleanup did not remove every disposable Docker resource.',
    );
  }
}

async function writeEvidence(configuration, checks, status) {
  await mkdir(configuration.evidenceDirectory, {
    mode: 0o700,
    recursive: true,
  });
  await writeFile(
    path.join(configuration.evidenceDirectory, 'result.json'),
    `${JSON.stringify(
      {
        checks,
        provider: configuration.providerId,
        runId: configuration.runId,
        status,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

function defaultDependencies() {
  return Object.freeze({
    browserContracts: runBrowserContracts,
    fetchImplementation: fetch,
    processRunner: runProcess,
    secretFactory: randomSecret,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
}

export async function runProviderGate(adapter, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration =
    options.configuration ?? providerGateConfiguration(adapter, environment);
  const dependencies = { ...defaultDependencies(), ...options.dependencies };
  const checks = {
    allowedLogin: false,
    cleanup: false,
    deepLinkReturn: false,
    deniedLogin: false,
    logout: false,
    providerOutageIsolation: false,
  };
  let prepared = false;
  try {
    await rm(configuration.evidenceDirectory, { force: true, recursive: true });
    await mkdir(configuration.evidenceDirectory, {
      mode: 0o700,
      recursive: true,
    });
    prepared = true;
    const providerSecrets = await prepareCredentials(
      adapter,
      configuration,
      environment,
      dependencies.secretFactory,
    );
    await cleanResources(adapter, configuration, dependencies.processRunner);
    await dependencies.processRunner('docker', [
      'compose',
      '--project-name',
      configuration.projectName,
      '--env-file',
      configuration.providerEnvironmentPath,
      '--file',
      adapter.composeFile,
      'up',
      '--detach',
      '--wait',
    ]);
    const providerMetadata = await waitForProvider(
      adapter,
      dependencies.fetchImplementation,
      dependencies.sleep,
    );
    const identities = await adapter.provision({
      fetchImplementation: dependencies.fetchImplementation,
      maskSecret: (value) => maskSecret(value, environment),
      secrets: providerSecrets,
    });

    await dependencies.processRunner('docker', [
      'volume',
      'create',
      configuration.gatewayVolume,
    ]);
    await dependencies.processRunner('docker', [
      'run',
      '--detach',
      '--name',
      configuration.containerName,
      '--network',
      'host',
      '--cap-drop',
      'ALL',
      '--init',
      '--read-only',
      '--security-opt',
      'no-new-privileges',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000',
      '--mount',
      `type=volume,source=${configuration.gatewayVolume},destination=/data`,
      '--env-file',
      configuration.gatewayEnvironmentPath,
      configuration.gatewayImage,
    ]);
    await waitForGateway(
      configuration,
      dependencies.fetchImplementation,
      dependencies.sleep,
    );
    await dependencies.browserContracts(
      adapter,
      identities,
      configuration,
      providerMetadata,
    );
    checks.allowedLogin = true;
    checks.deepLinkReturn = true;
    checks.deniedLogin = true;
    checks.logout = true;

    await dependencies.processRunner('docker', [
      'compose',
      '--project-name',
      configuration.projectName,
      '--env-file',
      configuration.providerEnvironmentPath,
      '--file',
      adapter.composeFile,
      'stop',
      ...adapter.outageServices,
    ]);
    await waitForProviderOutage(
      adapter,
      dependencies.fetchImplementation,
      dependencies.sleep,
    );
    const [health, matrix] = await Promise.all([
      dependencies.fetchImplementation(`${configuration.gatewayOrigin}/health`),
      dependencies.fetchImplementation(
        `${configuration.gatewayOrigin}/_matrix/push/v1/notify`,
        {
          body: JSON.stringify({ notification: { devices: [] } }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        },
      ),
    ]);
    requireCondition(
      health.status === 200,
      'Provider outage broke public health.',
    );
    requireCondition(
      matrix.status === 200,
      'Provider outage broke Matrix notification handling.',
    );
    checks.providerOutageIsolation = true;
    await writeEvidence(configuration, checks, 'passed');
  } catch (error) {
    await writeEvidence(configuration, checks, 'failed');
    throw error;
  } finally {
    if (prepared) {
      try {
        await cleanResources(
          adapter,
          configuration,
          dependencies.processRunner,
        );
        checks.cleanup = true;
      } finally {
        await rm(configuration.workDirectory, { force: true, recursive: true });
        const status = Object.values(checks).every(Boolean)
          ? 'passed'
          : 'failed';
        await writeEvidence(configuration, checks, status);
      }
    }
  }
  console.info(`${adapter.displayName} provider gate passed.`);
}

export async function cleanupProviderGate(adapter, options = {}) {
  const environment = options.environment ?? process.env;
  const configuration =
    options.configuration ?? providerGateConfiguration(adapter, environment);
  const dependencies = { ...defaultDependencies(), ...options.dependencies };
  let credentialsExist = true;
  try {
    await access(configuration.providerEnvironmentPath);
  } catch {
    credentialsExist = false;
  }
  try {
    if (!credentialsExist) {
      await prepareCredentials(
        adapter,
        configuration,
        environment,
        dependencies.secretFactory,
      );
    }
    await cleanResources(adapter, configuration, dependencies.processRunner);
  } finally {
    await rm(configuration.workDirectory, { force: true, recursive: true });
  }
}
