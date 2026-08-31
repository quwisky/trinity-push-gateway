import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [provider, outputDirectory] = process.argv.slice(2);
if (!['authentik', 'pocket-id'].includes(provider) || !outputDirectory) {
  throw new Error('Usage: prepare-provider.mjs <pocket-id|authentik> <output>');
}

const secret = (bytes = 32) => randomBytes(bytes).toString('base64url');
const values =
  provider === 'pocket-id'
    ? {
        POCKET_ID_ENCRYPTION_KEY: secret(),
        POCKET_ID_STATIC_API_KEY: secret(),
        POCKET_ID_GATEWAY_CLIENT_SECRET: secret(36),
      }
    : {
        AUTHENTIK_BOOTSTRAP_PASSWORD: secret(24),
        AUTHENTIK_BOOTSTRAP_TOKEN: secret(),
        AUTHENTIK_GATEWAY_ALLOWED_PASSWORD: secret(24),
        AUTHENTIK_GATEWAY_CLIENT_SECRET: secret(36),
        AUTHENTIK_GATEWAY_DENIED_PASSWORD: secret(24),
        AUTHENTIK_POSTGRESQL_PASSWORD: secret(24),
        AUTHENTIK_SECRET_KEY: secret(48),
      };

await mkdir(outputDirectory, { mode: 0o700, recursive: true });
for (const value of Object.values(values)) {
  console.info(`::add-mask::${value}`);
}

const providerEnvironment = Object.entries(values)
  .map(([name, value]) => `${name}=${value}`)
  .join('\n');
await writeFile(
  path.join(outputDirectory, 'provider.env'),
  `${providerEnvironment}\n`,
  { mode: 0o600 },
);

const providerOrigin =
  provider === 'pocket-id' ? 'http://127.0.0.1:1411' : 'http://127.0.0.1:9000';
const issuer =
  provider === 'pocket-id'
    ? providerOrigin
    : `${providerOrigin}/application/o/trinity-push-gateway/`;
const clientSecret =
  provider === 'pocket-id'
    ? values.POCKET_ID_GATEWAY_CLIENT_SECRET
    : values.AUTHENTIK_GATEWAY_CLIENT_SECRET;
const gatewayEnvironment = {
  TRINITY_PUSH_GATEWAY_ADMIN_BACKUP_DIRECTORY: '/data/backups',
  TRINITY_PUSH_GATEWAY_ADMIN_DATABASE_PATH: '/data/admin.sqlite',
  TRINITY_PUSH_GATEWAY_ADMIN_ENABLED: 'true',
  TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_ID: 'gateway-live-client',
  TRINITY_PUSH_GATEWAY_ADMIN_OIDC_CLIENT_SECRET: clientSecret,
  TRINITY_PUSH_GATEWAY_ADMIN_OIDC_GROUP_CLAIM: 'groups',
  TRINITY_PUSH_GATEWAY_ADMIN_OIDC_ISSUER: issuer,
  TRINITY_PUSH_GATEWAY_ADMIN_OIDC_REQUIRED_GROUP: 'gateway-operators',
  TRINITY_PUSH_GATEWAY_ADMIN_OIDC_SCOPES:
    provider === 'pocket-id'
      ? 'openid profile email groups'
      : 'openid profile email',
  TRINITY_PUSH_GATEWAY_ADMIN_OIDC_TOKEN_ENDPOINT_AUTH_METHOD:
    provider === 'pocket-id' ? 'client_secret_basic' : 'client_secret_post',
  TRINITY_PUSH_GATEWAY_ADMIN_PUBLIC_ORIGIN: 'http://127.0.0.1:3000',
  TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET: secret(36),
  TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
  TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
  TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'test-private-key',
  TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'example-project',
  TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'test-fingerprint-key-32-bytes-long',
  TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
};
console.info(
  `::add-mask::${gatewayEnvironment.TRINITY_PUSH_GATEWAY_ADMIN_SESSION_SECRET}`,
);
await writeFile(
  path.join(outputDirectory, 'gateway.env'),
  `${Object.entries(gatewayEnvironment)
    .map(([name, value]) => `${name}=${value}`)
    .join('\n')}\n`,
  { mode: 0o600 },
);

const browserState =
  provider === 'pocket-id'
    ? { provider, providerOrigin }
    : {
        allowed: {
          password: values.AUTHENTIK_GATEWAY_ALLOWED_PASSWORD,
          username: 'gateway-allowed',
        },
        denied: {
          password: values.AUTHENTIK_GATEWAY_DENIED_PASSWORD,
          username: 'gateway-denied',
        },
        provider,
        providerOrigin,
      };
await writeFile(
  path.join(outputDirectory, 'browser-state.json'),
  `${JSON.stringify(browserState)}\n`,
  { mode: 0o600 },
);
