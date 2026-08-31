import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import {
  cleanupProviderGate,
  providerGateConfiguration,
  runProviderGate,
} from './provider-gate-lifecycle.mjs';

const temporaryDirectories = [];

const adapter = Object.freeze({
  clientId: 'test-client',
  composeFile: '/workspace/compose.test.yml',
  displayName: 'Test Provider',
  id: 'test-provider',
  issuer: 'http://127.0.0.1:9191',
  outageServices: Object.freeze(['provider']),
  providerOrigin: 'http://127.0.0.1:9191',
  requiredGroup: 'operators',
  scopes: 'openid groups',
  tokenEndpointAuthMethod: 'client_secret_basic',
  createProviderSecrets: (secretFactory) => ({
    clientSecret: secretFactory(36),
    providerSecret: secretFactory(24),
  }),
  providerEnvironment: (secrets) => ({
    TEST_CLIENT_SECRET: secrets.clientSecret,
    TEST_PROVIDER_SECRET: secrets.providerSecret,
  }),
});

async function temporaryGate() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'provider-lifecycle-test-'),
  );
  temporaryDirectories.push(root);
  const environment = {
    PROVIDER_GATE_EVIDENCE_DIRECTORY: path.join(root, 'evidence'),
    PROVIDER_GATE_RUN_ID: 'unit-test',
    PROVIDER_GATE_WORK_DIRECTORY: path.join(root, 'credentials'),
  };
  return {
    configuration: providerGateConfiguration(adapter, environment),
    environment,
  };
}

function successfulDependencies(configuration, options = {}) {
  const operations = [];
  let providerUp = false;
  const processRunner = async (command, arguments_) => {
    operations.push([command, ...arguments_]);
    if (arguments_.includes('up')) {
      providerUp = true;
    }
    if (arguments_.includes('stop') || arguments_.includes('down')) {
      providerUp = false;
    }
    return { stderr: '', stdout: '' };
  };
  const fetchImplementation = async (url) => {
    const parsed = new URL(url);
    if (parsed.origin === adapter.issuer) {
      if (!providerUp) {
        throw new Error('provider unavailable');
      }
      return Response.json({
        authorization_endpoint: `${adapter.issuer}/authorize`,
        end_session_endpoint: `${adapter.issuer}/logout`,
        issuer: adapter.issuer,
        jwks_uri: `${adapter.issuer}/jwks`,
        token_endpoint: `${adapter.issuer}/token`,
      });
    }
    return new Response('', { status: 200 });
  };
  return {
    dependencies: {
      browserContracts:
        options.browserContracts ??
        (async () => {
          await writeFile(configuration.screenshotPath, 'visual proof');
        }),
      fetchImplementation,
      processRunner,
      secretFactory: (bytes) => `secret-sentinel-${String(bytes)}`,
      sleep: async () => {},
    },
    operations,
  };
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

test('one lifecycle owns provisioning through evidence and cleanup', async () => {
  const { configuration, environment } = await temporaryGate();
  const { dependencies, operations } = successfulDependencies(configuration);
  let provisioned = false;
  const testAdapter = {
    ...adapter,
    async provision() {
      provisioned = true;
      assert.equal(
        (await stat(configuration.providerEnvironmentPath)).mode & 0o777,
        0o600,
      );
      assert.equal(
        (await stat(configuration.gatewayEnvironmentPath)).mode & 0o777,
        0o600,
      );
      return { allowed: {}, denied: {} };
    },
  };

  await runProviderGate(testAdapter, {
    configuration,
    dependencies,
    environment,
  });

  assert.equal(provisioned, true);
  await assert.rejects(access(configuration.workDirectory));
  assert.equal(
    await readFile(configuration.screenshotPath, 'utf8'),
    'visual proof',
  );
  const evidence = await readFile(
    path.join(configuration.evidenceDirectory, 'result.json'),
    'utf8',
  );
  assert.doesNotMatch(evidence, /secret-sentinel/u);
  assert.deepEqual(JSON.parse(evidence), {
    checks: {
      allowedLogin: true,
      cleanup: true,
      deepLinkReturn: true,
      deniedLogin: true,
      logout: true,
      providerOutageIsolation: true,
    },
    provider: adapter.id,
    runId: 'unit-test',
    status: 'passed',
  });
  assert.ok(operations.some((operation) => operation.includes('up')));
  assert.ok(operations.some((operation) => operation.includes('run')));
  assert.ok(operations.some((operation) => operation.includes('stop')));
  assert.ok(operations.some((operation) => operation.includes('down')));
});

test('a failed browser contract still removes credentials and disposable resources', async () => {
  const { configuration, environment } = await temporaryGate();
  const { dependencies, operations } = successfulDependencies(configuration, {
    browserContracts: async () => {
      throw new Error('browser contract failed');
    },
  });
  const testAdapter = {
    ...adapter,
    provision: async () => ({ allowed: {}, denied: {} }),
  };

  await assert.rejects(
    runProviderGate(testAdapter, {
      configuration,
      dependencies,
      environment,
    }),
    /browser contract failed/u,
  );

  await assert.rejects(access(configuration.workDirectory));
  const evidence = JSON.parse(
    await readFile(
      path.join(configuration.evidenceDirectory, 'result.json'),
      'utf8',
    ),
  );
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.checks.cleanup, true);
  assert.ok(operations.some((operation) => operation.includes('down')));
});

test('credential preparation failures still remove the private work directory', async () => {
  const { configuration, environment } = await temporaryGate();
  const { dependencies } = successfulDependencies(configuration);

  await assert.rejects(
    runProviderGate(adapter, {
      configuration,
      dependencies: {
        ...dependencies,
        secretFactory: () => {
          throw new Error('secret generation failed');
        },
      },
      environment,
    }),
    /secret generation failed/u,
  );

  await assert.rejects(access(configuration.workDirectory));
  const evidence = JSON.parse(
    await readFile(
      path.join(configuration.evidenceDirectory, 'result.json'),
      'utf8',
    ),
  );
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.checks.cleanup, true);
});

test('cleanup command failures fail the gate and cannot be reported as clean', async () => {
  const { configuration, environment } = await temporaryGate();
  const { dependencies } = successfulDependencies(configuration);
  const successfulRunner = dependencies.processRunner;
  let composeDowns = 0;
  const testAdapter = {
    ...adapter,
    provision: async () => ({ allowed: {}, denied: {} }),
  };

  await assert.rejects(
    runProviderGate(testAdapter, {
      configuration,
      dependencies: {
        ...dependencies,
        processRunner: async (command, arguments_, options) => {
          if (arguments_.includes('down')) {
            composeDowns += 1;
            if (composeDowns === 2) {
              throw new Error('compose teardown failed');
            }
          }
          return successfulRunner(command, arguments_, options);
        },
      },
      environment,
    }),
    /cleanup did not remove every disposable Docker resource/u,
  );

  await assert.rejects(access(configuration.workDirectory));
  const evidence = JSON.parse(
    await readFile(
      path.join(configuration.evidenceDirectory, 'result.json'),
      'utf8',
    ),
  );
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.checks.cleanup, false);
});

test('the explicit cleanup entry point reuses lifecycle-owned resource names', async () => {
  const { configuration, environment } = await temporaryGate();
  const { dependencies, operations } = successfulDependencies(configuration);

  await cleanupProviderGate(adapter, {
    configuration,
    dependencies,
    environment,
  });

  await assert.rejects(access(configuration.workDirectory));
  assert.ok(
    operations.some(
      (operation) =>
        operation.includes(configuration.projectName) &&
        operation.includes('down'),
    ),
  );
});
