import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pocketIdAdapter } from './pocket-id-adapter.mjs';

test('Pocket ID provisioning keeps provider API variance behind the adapter', async () => {
  const requests = [];
  const responses = [
    { id: 'operator-group-id' },
    { id: 'allowed-user-id' },
    { id: 'denied-user-id' },
    {},
    {},
    {},
    { token: 'allowed-one-time-token' },
    { token: 'denied-one-time-token' },
  ];
  const masked = [];
  const secrets = {
    clientSecret: 'client-secret-sentinel',
    encryptionKey: 'encryption-key-sentinel',
    staticApiKey: 'api-key-sentinel',
  };

  const identities = await pocketIdAdapter.provision({
    async fetchImplementation(url, init) {
      requests.push({
        body: init.body === undefined ? undefined : JSON.parse(init.body),
        headers: init.headers,
        method: init.method,
        pathname: new URL(url).pathname,
      });
      return Response.json(responses.shift());
    },
    maskSecret: (value) => masked.push(value),
    secrets,
  });

  assert.deepEqual(
    requests.map(({ method, pathname }) => [method, pathname]),
    [
      ['POST', '/api/user-groups'],
      ['POST', '/api/users'],
      ['POST', '/api/users'],
      ['POST', '/api/oidc/clients'],
      ['POST', '/api/oidc/clients/gateway-live-client/secrets'],
      ['PUT', '/api/oidc/clients/gateway-live-client/allowed-user-groups'],
      ['POST', '/api/users/allowed-user-id/one-time-access-token'],
      ['POST', '/api/users/denied-user-id/one-time-access-token'],
    ],
  );
  assert.deepEqual(requests[0]?.body, {
    friendlyName: 'Gateway Operators',
    name: 'gateway-operators',
  });
  assert.deepEqual(requests[1]?.body.userGroupIds, ['operator-group-id']);
  assert.deepEqual(requests[2]?.body.userGroupIds, []);
  assert.deepEqual(requests[5]?.body.userGroupIds, ['operator-group-id']);
  assert.ok(
    requests.every(
      (request) => request.headers['x-api-key'] === secrets.staticApiKey,
    ),
  );
  assert.deepEqual(identities, {
    allowed: { oneTimeToken: 'allowed-one-time-token' },
    denied: { oneTimeToken: 'denied-one-time-token' },
  });
  assert.deepEqual(masked, ['allowed-one-time-token', 'denied-one-time-token']);
});

test('Pocket ID browser variance exchanges one-time tokens and normalizes denial', async () => {
  const exchanges = [];
  const navigations = [];
  const context = {
    request: {
      async post(url) {
        exchanges.push(url);
        return { ok: () => true, status: () => 200 };
      },
    },
  };

  await pocketIdAdapter.authenticate({
    context,
    identity: { oneTimeToken: 'token with spaces' },
  });
  assert.deepEqual(exchanges, [
    'http://127.0.0.1:1411/api/one-time-access-token/token%20with%20spaces',
  ]);
  assert.equal(
    pocketIdAdapter.isDeniedProviderUrl(
      new URL('http://127.0.0.1:1411/interaction/error?error=not%20allowed'),
    ),
    true,
  );
  await pocketIdAdapter.normalizeDeniedPage(
    {
      goto: async (url) => navigations.push(url),
      url: () =>
        'http://127.0.0.1:1411/interaction/error?error=user%20not%20allowed',
    },
    'http://127.0.0.1:3000',
  );
  assert.deepEqual(navigations, [
    'http://127.0.0.1:3000/admin/sign-in?reason=forbidden',
  ]);
});
