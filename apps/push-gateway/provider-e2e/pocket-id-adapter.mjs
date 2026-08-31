import path from 'node:path';
import { fileURLToPath } from 'node:url';

const providerRoot = path.dirname(fileURLToPath(import.meta.url));

function requiredString(value, description) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Pocket ID did not return ${description}.`);
  }
  return value;
}

async function providerRequest(
  fetchImplementation,
  secrets,
  pathname,
  method,
  body,
) {
  const response = await fetchImplementation(
    `${pocketIdAdapter.providerOrigin}${pathname}`,
    {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-api-key': secrets.staticApiKey,
      },
      method,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Pocket ID ${method} ${pathname} returned ${response.status}.`,
    );
  }
  return response.status === 204 ? undefined : response.json();
}

export const pocketIdAdapter = Object.freeze({
  clientId: 'gateway-live-client',
  composeFile: path.join(providerRoot, 'compose.pocket-id.yml'),
  displayName: 'Pocket ID',
  id: 'pocket-id',
  issuer: 'http://127.0.0.1:1411',
  outageServices: Object.freeze(['pocket-id']),
  providerOrigin: 'http://127.0.0.1:1411',
  requiredGroup: 'gateway-operators',
  scopes: 'openid profile email groups',
  tokenEndpointAuthMethod: 'client_secret_basic',

  createProviderSecrets(randomSecret) {
    return Object.freeze({
      clientSecret: randomSecret(36),
      encryptionKey: randomSecret(32),
      staticApiKey: randomSecret(32),
    });
  },

  providerEnvironment(secrets) {
    return Object.freeze({
      POCKET_ID_ENCRYPTION_KEY: secrets.encryptionKey,
      POCKET_ID_GATEWAY_CLIENT_SECRET: secrets.clientSecret,
      POCKET_ID_STATIC_API_KEY: secrets.staticApiKey,
    });
  },

  async provision({ fetchImplementation, maskSecret, secrets }) {
    const request = (pathname, method, body) =>
      providerRequest(fetchImplementation, secrets, pathname, method, body);
    const group = await request('/api/user-groups', 'POST', {
      friendlyName: 'Gateway Operators',
      name: pocketIdAdapter.requiredGroup,
    });
    const groupId = requiredString(group?.id, 'an operator-group identifier');
    const allowed = await request('/api/users', 'POST', {
      displayName: 'Gateway Allowed Operator',
      email: 'gateway-allowed@example.test',
      emailVerified: true,
      firstName: 'Gateway',
      isAdmin: false,
      lastName: 'Allowed',
      userGroupIds: [groupId],
      username: 'gateway-allowed',
    });
    const denied = await request('/api/users', 'POST', {
      displayName: 'Gateway Denied Operator',
      email: 'gateway-denied@example.test',
      emailVerified: true,
      firstName: 'Gateway',
      isAdmin: false,
      lastName: 'Denied',
      userGroupIds: [],
      username: 'gateway-denied',
    });
    await request('/api/oidc/clients', 'POST', {
      accessTokenDurationMinutes: 5,
      callbackURLs: ['http://127.0.0.1:3000/admin/auth/callback'],
      credentials: { federatedIdentities: [], secrets: [] },
      description: 'Ephemeral Trinity Push Gateway compatibility gate',
      id: pocketIdAdapter.clientId,
      isGroupRestricted: true,
      isPublic: false,
      logoutCallbackURLs: ['http://127.0.0.1:3000/admin/'],
      name: 'Trinity Push Gateway CI',
      pkceEnabled: true,
      refreshTokenDurationMinutes: 60,
      requiresPushedAuthorizationRequests: false,
      requiresReauthentication: false,
      skipConsent: true,
    });
    await request(
      `/api/oidc/clients/${pocketIdAdapter.clientId}/secrets`,
      'POST',
      { secret: secrets.clientSecret },
    );
    await request(
      `/api/oidc/clients/${pocketIdAdapter.clientId}/allowed-user-groups`,
      'PUT',
      { userGroupIds: [groupId] },
    );
    const allowedToken = await request(
      `/api/users/${encodeURIComponent(requiredString(allowed?.id, 'an allowed-user identifier'))}/one-time-access-token`,
      'POST',
      {},
    );
    const deniedToken = await request(
      `/api/users/${encodeURIComponent(requiredString(denied?.id, 'a denied-user identifier'))}/one-time-access-token`,
      'POST',
      {},
    );
    const allowedOneTimeToken = requiredString(
      allowedToken?.token,
      'an allowed-user one-time token',
    );
    const deniedOneTimeToken = requiredString(
      deniedToken?.token,
      'a denied-user one-time token',
    );
    maskSecret(allowedOneTimeToken);
    maskSecret(deniedOneTimeToken);
    return Object.freeze({
      allowed: Object.freeze({ oneTimeToken: allowedOneTimeToken }),
      denied: Object.freeze({ oneTimeToken: deniedOneTimeToken }),
    });
  },

  async authenticate({ context, identity, navigate }) {
    const response = await context.request.post(
      `${pocketIdAdapter.providerOrigin}/api/one-time-access-token/${encodeURIComponent(identity.oneTimeToken)}`,
    );
    if (!response.ok()) {
      throw new Error(
        `Pocket ID one-time token exchange returned ${response.status()}.`,
      );
    }
    await navigate();
  },

  async normalizeProviderDenial({ gatewayOrigin, page }) {
    await page.waitForURL(
      (url) =>
        url.origin === pocketIdAdapter.providerOrigin &&
        url.pathname === '/interaction/error',
      { timeout: 60_000 },
    );
    const denial = new URL(page.url());
    if (
      !denial.searchParams.get('error')?.toLowerCase().includes('not allowed')
    ) {
      throw new Error('Pocket ID returned an unexpected group denial.');
    }
    await page.goto(`${gatewayOrigin}/admin/sign-in?reason=forbidden`);
  },
});
