import path from 'node:path';
import { fileURLToPath } from 'node:url';

const providerRoot = path.dirname(fileURLToPath(import.meta.url));

function requiredString(value, description) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Authentik did not return ${description}.`);
  }
  return value;
}

async function blueprintObject(
  fetchImplementation,
  bootstrapToken,
  pathname,
  field,
  expected,
) {
  const url = new URL(`/api/v3${pathname}`, authentikAdapter.providerOrigin);
  url.searchParams.set(field, expected);
  const response = await fetchImplementation(url, {
    headers: { authorization: `Bearer ${bootstrapToken}` },
    signal: AbortSignal.timeout(3_000),
  });
  if (!response.ok) {
    throw new Error(`Authentik GET ${pathname} returned ${response.status}.`);
  }
  const body = await response.json();
  const matches = Array.isArray(body?.results)
    ? body.results.filter((result) => result?.[field] === expected)
    : [];
  if (matches.length !== 1) {
    throw new Error(
      `Authentik blueprint did not provision exactly one ${field}=${expected}.`,
    );
  }
  return matches[0];
}

export const authentikAdapter = Object.freeze({
  clientId: 'gateway-live-client',
  composeFile: path.join(providerRoot, 'compose.authentik.yml'),
  displayName: 'Authentik',
  id: 'authentik',
  issuer: 'http://127.0.0.1:9000/application/o/trinity-push-gateway/',
  outageServices: Object.freeze(['server', 'worker']),
  providerOrigin: 'http://127.0.0.1:9000',
  requiredGroup: 'gateway-operators',
  scopes: 'openid profile email',
  tokenEndpointAuthMethod: 'client_secret_post',

  createProviderSecrets(randomSecret) {
    return Object.freeze({
      allowedPassword: randomSecret(24),
      bootstrapPassword: randomSecret(24),
      bootstrapToken: randomSecret(32),
      clientSecret: randomSecret(36),
      deniedPassword: randomSecret(24),
      postgresqlPassword: randomSecret(24),
      secretKey: randomSecret(48),
    });
  },

  providerEnvironment(secrets) {
    return Object.freeze({
      AUTHENTIK_BOOTSTRAP_PASSWORD: secrets.bootstrapPassword,
      AUTHENTIK_BOOTSTRAP_TOKEN: secrets.bootstrapToken,
      AUTHENTIK_GATEWAY_ALLOWED_PASSWORD: secrets.allowedPassword,
      AUTHENTIK_GATEWAY_CLIENT_SECRET: secrets.clientSecret,
      AUTHENTIK_GATEWAY_DENIED_PASSWORD: secrets.deniedPassword,
      AUTHENTIK_POSTGRESQL_PASSWORD: secrets.postgresqlPassword,
      AUTHENTIK_SECRET_KEY: secrets.secretKey,
    });
  },

  async provision({ fetchImplementation, secrets }) {
    const request = (pathname, field, expected) =>
      blueprintObject(
        fetchImplementation,
        secrets.bootstrapToken,
        pathname,
        field,
        expected,
      );
    const [group, allowed, denied, application] = await Promise.all([
      request('/core/groups/', 'name', authentikAdapter.requiredGroup),
      request('/core/users/', 'username', 'gateway-allowed'),
      request('/core/users/', 'username', 'gateway-denied'),
      request('/core/applications/', 'slug', 'trinity-push-gateway'),
    ]);
    const groupId = requiredString(group?.pk, 'an operator-group identifier');
    requiredString(application?.slug, 'an application slug');
    if (!Array.isArray(allowed?.groups) || !allowed.groups.includes(groupId)) {
      throw new Error(
        'Authentik allowed identity is missing the operator group.',
      );
    }
    if (Array.isArray(denied?.groups) && denied.groups.includes(groupId)) {
      throw new Error(
        'Authentik denied identity unexpectedly has the operator group.',
      );
    }
    return Object.freeze({
      allowed: Object.freeze({
        password: secrets.allowedPassword,
        username: 'gateway-allowed',
      }),
      denied: Object.freeze({
        password: secrets.deniedPassword,
        username: 'gateway-denied',
      }),
    });
  },

  async authenticate({ identity, navigate, page }) {
    await navigate();
    const username = page.getByLabel('Username');
    try {
      await username.waitFor({ state: 'visible', timeout: 60_000 });
    } catch (cause) {
      throw new Error(
        `Authentik credential form did not become ready at ${page.url()}.`,
        { cause },
      );
    }
    await username.fill(identity.username);
    const password = page.getByLabel('Password');
    if (!(await password.isVisible())) {
      await page.locator('button[type="submit"]').click();
      await password.waitFor({ state: 'visible', timeout: 60_000 });
    }
    await password.fill(identity.password);
    await page.locator('button[type="submit"]').click();
  },
});
