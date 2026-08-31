import { chmod, readFile, writeFile } from 'node:fs/promises';

const outputDirectory = process.argv[2];
const origin = 'http://127.0.0.1:1411';
const apiKey = process.env.POCKET_ID_STATIC_API_KEY;
const clientSecret = process.env.POCKET_ID_GATEWAY_CLIENT_SECRET;
if (!outputDirectory || !apiKey || !clientSecret) {
  throw new Error(
    'Pocket ID output directory and generated secrets are required.',
  );
}

async function api(pathname, method, body) {
  const response = await fetch(`${origin}${pathname}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    method,
  });
  if (!response.ok) {
    throw new Error(
      `${method} ${pathname} returned ${response.status}: ${await response.text()}`,
    );
  }
  return response.status === 204 ? undefined : response.json();
}

const group = await api('/api/user-groups', 'POST', {
  friendlyName: 'Gateway Operators',
  name: 'gateway-operators',
});
const allowed = await api('/api/users', 'POST', {
  displayName: 'Gateway Allowed Operator',
  email: 'gateway-allowed@example.test',
  emailVerified: true,
  firstName: 'Gateway',
  isAdmin: false,
  lastName: 'Allowed',
  userGroupIds: [group.id],
  username: 'gateway-allowed',
});
const denied = await api('/api/users', 'POST', {
  displayName: 'Gateway Denied Operator',
  email: 'gateway-denied@example.test',
  emailVerified: true,
  firstName: 'Gateway',
  isAdmin: false,
  lastName: 'Denied',
  userGroupIds: [],
  username: 'gateway-denied',
});
await api('/api/oidc/clients', 'POST', {
  accessTokenDurationMinutes: 5,
  callbackURLs: ['http://127.0.0.1:3000/admin/auth/callback'],
  credentials: { federatedIdentities: [], secrets: [] },
  description: 'Ephemeral Trinity Push Gateway compatibility gate',
  id: 'gateway-live-client',
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
await api('/api/oidc/clients/gateway-live-client/secrets', 'POST', {
  secret: clientSecret,
});
await api('/api/oidc/clients/gateway-live-client/allowed-user-groups', 'PUT', {
  userGroupIds: [group.id],
});
const allowedToken = await api(
  `/api/users/${encodeURIComponent(allowed.id)}/one-time-access-token`,
  'POST',
  {},
);
const deniedToken = await api(
  `/api/users/${encodeURIComponent(denied.id)}/one-time-access-token`,
  'POST',
  {},
);
console.info(`::add-mask::${allowedToken.token}`);
console.info(`::add-mask::${deniedToken.token}`);

const statePath = `${outputDirectory}/browser-state.json`;
const state = JSON.parse(await readFile(statePath, 'utf8'));
await writeFile(
  statePath,
  `${JSON.stringify({
    ...state,
    allowed: { oneTimeToken: allowedToken.token },
    denied: { oneTimeToken: deniedToken.token },
  })}\n`,
  { mode: 0o600 },
);
await chmod(statePath, 0o600);
