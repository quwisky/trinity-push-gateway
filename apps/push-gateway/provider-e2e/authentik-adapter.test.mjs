import assert from 'node:assert/strict';
import { test } from 'node:test';

import { authentikAdapter } from './authentik-adapter.mjs';

test('Authentik maps fresh disposable secrets into its provider environment', () => {
  let sequence = 0;
  const secrets = authentikAdapter.createProviderSecrets(
    (bytes) => `secret-${String(bytes)}-${String((sequence += 1))}`,
  );

  assert.deepEqual(secrets, {
    allowedPassword: 'secret-24-1',
    bootstrapPassword: 'secret-24-2',
    bootstrapToken: 'secret-32-3',
    clientSecret: 'secret-36-4',
    deniedPassword: 'secret-24-5',
    postgresqlPassword: 'secret-24-6',
    secretKey: 'secret-48-7',
  });
  assert.deepEqual(authentikAdapter.providerEnvironment(secrets), {
    AUTHENTIK_BOOTSTRAP_PASSWORD: secrets.bootstrapPassword,
    AUTHENTIK_BOOTSTRAP_TOKEN: secrets.bootstrapToken,
    AUTHENTIK_GATEWAY_ALLOWED_PASSWORD: secrets.allowedPassword,
    AUTHENTIK_GATEWAY_CLIENT_SECRET: secrets.clientSecret,
    AUTHENTIK_GATEWAY_DENIED_PASSWORD: secrets.deniedPassword,
    AUTHENTIK_POSTGRESQL_PASSWORD: secrets.postgresqlPassword,
    AUTHENTIK_SECRET_KEY: secrets.secretKey,
  });
});

test('Authentik provisioning verifies blueprint-owned provider state', async () => {
  const requests = [];
  const groupId = 'operator-group-id';
  const responses = {
    '/api/v3/core/applications/': {
      results: [{ slug: 'trinity-push-gateway' }],
    },
    '/api/v3/core/groups/': {
      results: [{ name: 'gateway-operators', pk: groupId }],
    },
    '/api/v3/core/users/allowed': {
      results: [{ groups: [groupId], username: 'gateway-allowed' }],
    },
    '/api/v3/core/users/denied': {
      results: [{ groups: [], username: 'gateway-denied' }],
    },
  };
  const secrets = {
    allowedPassword: 'allowed-password-sentinel',
    bootstrapPassword: 'bootstrap-password-sentinel',
    bootstrapToken: 'bootstrap-token-sentinel',
    clientSecret: 'client-secret-sentinel',
    deniedPassword: 'denied-password-sentinel',
    postgresqlPassword: 'postgres-password-sentinel',
    secretKey: 'secret-key-sentinel',
  };

  const identities = await authentikAdapter.provision({
    async fetchImplementation(input, init) {
      const url = new URL(input);
      requests.push({
        authorization: init.headers.authorization,
        pathname: url.pathname,
        search: url.search,
      });
      const responseKey =
        url.pathname === '/api/v3/core/users/'
          ? `${url.pathname}${url.searchParams.get('username')?.endsWith('allowed') ? 'allowed' : 'denied'}`
          : url.pathname;
      return Response.json(responses[responseKey]);
    },
    secrets,
  });

  assert.deepEqual(
    requests.map(({ pathname, search }) => [pathname, search]),
    [
      ['/api/v3/core/groups/', '?name=gateway-operators'],
      ['/api/v3/core/users/', '?username=gateway-allowed'],
      ['/api/v3/core/users/', '?username=gateway-denied'],
      ['/api/v3/core/applications/', '?slug=trinity-push-gateway'],
    ],
  );
  assert.ok(
    requests.every(
      ({ authorization }) =>
        authorization === 'Bearer bootstrap-token-sentinel',
    ),
  );
  assert.deepEqual(identities, {
    allowed: {
      password: 'allowed-password-sentinel',
      username: 'gateway-allowed',
    },
    denied: {
      password: 'denied-password-sentinel',
      username: 'gateway-denied',
    },
  });
});

test('Authentik browser variance navigates before entering credentials', async () => {
  const operations = [];
  let passwordVisible = false;
  const username = {
    fill: async (value) => operations.push(`username:${value}`),
    waitFor: async (options) =>
      operations.push(`username:${options.state}:${String(options.timeout)}`),
  };
  const password = {
    fill: async (value) => operations.push(`password:${value}`),
    isVisible: async () => passwordVisible,
    waitFor: async (options) => {
      passwordVisible = true;
      operations.push(`password:${options.state}:${String(options.timeout)}`);
    },
  };
  const submit = {
    click: async () => operations.push('submit'),
  };

  await authentikAdapter.authenticate({
    identity: { password: 'allowed-password', username: 'allowed-user' },
    navigate: async () => operations.push('navigate'),
    page: {
      getByLabel: (label) => (label === 'Username' ? username : password),
      locator: () => submit,
      url: () => 'http://127.0.0.1:9000/if/flow/default-authentication-flow/',
    },
  });

  assert.deepEqual(operations, [
    'navigate',
    'username:visible:60000',
    'username:allowed-user',
    'submit',
    'password:visible:60000',
    'password:allowed-password',
    'submit',
  ]);
  assert.equal(authentikAdapter.normalizeProviderDenial, undefined);
});
