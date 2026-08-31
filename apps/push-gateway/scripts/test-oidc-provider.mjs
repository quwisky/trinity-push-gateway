import http from 'node:http';

import { Provider } from 'oidc-provider';

const clientId = 'gateway-contract-client';
const clientSecret = 'test-only-client-secret-000000000000';
const callbackUrl = 'http://127.0.0.1/admin/auth/callback';
const postLogoutUrl = 'http://127.0.0.1/admin/';
const profile = process.argv[2] ?? 'pocket-id';
const mode = process.argv[3] ?? 'success';
const clientSecretMethod = process.argv[4] ?? 'client_secret_basic';

if (!['authentik', 'pocket-id'].includes(profile)) {
  throw new Error(`Unknown provider profile: ${profile}`);
}
if (!['missing-group', 'no-profile', 'success', 'wrong-group'].includes(mode)) {
  throw new Error(`Unknown provider mode: ${mode}`);
}
if (
  !['client_secret_basic', 'client_secret_post'].includes(clientSecretMethod)
) {
  throw new Error(
    `Unknown client authentication method: ${clientSecretMethod}`,
  );
}

function emit(event) {
  process.stdout.write(`HARNESS ${JSON.stringify(event)}\n`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

let dispatch = (_request, response) => {
  response.writeHead(503).end();
};
const server = http.createServer((request, response) => {
  Promise.resolve(dispatch(request, response)).catch((error) => {
    if (!response.headersSent) {
      response.writeHead(500);
    }
    response.end('test provider failed');
    console.error(error);
  });
});

await listen(server);
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Test provider did not expose a TCP address.');
}
const issuer = `http://127.0.0.1:${address.port}`;
const groupClaim =
  mode === 'missing-group'
    ? undefined
    : mode === 'wrong-group'
      ? ['other-group']
      : ['gateway-operators', 'auditors'];
const account = {
  sub: 'operator-123',
  ...(groupClaim === undefined ? {} : { groups: groupClaim }),
  ...(mode === 'no-profile'
    ? {}
    : { email: 'operator@example.test', name: 'Gateway Operator' }),
};
const claims =
  profile === 'pocket-id'
    ? {
        email: ['email'],
        groups: ['groups'],
        openid: ['sub'],
        profile: ['name'],
      }
    : {
        email: ['email'],
        openid: ['sub'],
        profile: ['name', 'groups'],
      };
const provider = new Provider(issuer, {
  claims,
  clients: [
    {
      client_id: clientId,
      client_secret: clientSecret,
      grant_types: ['authorization_code'],
      post_logout_redirect_uris: [postLogoutUrl],
      redirect_uris: [callbackUrl],
      response_types: ['code'],
      token_endpoint_auth_method: clientSecretMethod,
    },
  ],
  cookies: {
    keys: ['test-only-cookie-signing-key-0000000000000000'],
  },
  features: {
    devInteractions: { enabled: false },
    userinfo: { enabled: false },
  },
  async findAccount(_context, accountId) {
    if (accountId !== account.sub) {
      return undefined;
    }
    return {
      accountId,
      async claims() {
        return account;
      },
    };
  },
  interactions: {
    url(_context, interaction) {
      return `/interaction/${interaction.uid}`;
    },
  },
  pkce: {
    required() {
      return true;
    },
  },
});

const oidc = provider.callback();
dispatch = async (request, response) => {
  const url = new URL(request.url ?? '/', issuer);
  if (request.method !== 'GET' || !url.pathname.startsWith('/interaction/')) {
    return oidc(request, response);
  }

  const details = await provider.interactionDetails(request, response);
  emit({ name: details.prompt.name, type: 'prompt' });
  if (details.prompt.name === 'login') {
    return provider.interactionFinished(
      request,
      response,
      { login: { accountId: account.sub } },
      { mergeWithLastSubmission: false },
    );
  }
  if (details.prompt.name === 'consent') {
    const grant = details.grantId
      ? await provider.Grant.find(details.grantId)
      : new provider.Grant({
          accountId: details.session.accountId,
          clientId: details.params.client_id,
        });
    if (!grant) {
      throw new Error('Test-provider interaction grant disappeared.');
    }
    if (details.prompt.details.missingOIDCScope) {
      grant.addOIDCScope(details.prompt.details.missingOIDCScope.join(' '));
    }
    if (details.prompt.details.missingOIDCClaims) {
      grant.addOIDCClaims(details.prompt.details.missingOIDCClaims);
    }
    for (const [resource, scopes] of Object.entries(
      details.prompt.details.missingResourceScopes ?? {},
    )) {
      grant.addResourceScope(resource, scopes.join(' '));
    }
    const grantId = await grant.save();
    return provider.interactionFinished(request, response, {
      consent: { grantId },
    });
  }
  throw new Error(`Unexpected interaction prompt: ${details.prompt.name}`);
};

emit({
  callbackUrl,
  clientId,
  clientSecret,
  clientSecretMethod,
  issuer,
  postLogoutUrl,
  profile,
  type: 'ready',
});

let closing = false;
async function shutdown(signal) {
  if (closing) {
    return;
  }
  closing = true;
  await close(server);
  emit({ listening: server.listening, signal, type: 'closed' });
}

process.once('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});
