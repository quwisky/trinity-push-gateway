import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createOidcAuthenticator } from '../../../src/bun/auth/oidc-client';
import { loadBunConfiguration } from '../../../src/bun/config';
import { startBunGateway } from '../../../src/bun/server';
import { canonicalMigrations } from '../support';
import { SqliteAuthSpikeHarness } from './support/sqlite-auth-spike';
import {
  startTestOidcProvider,
  type TestOidcProvider,
} from './support/test-oidc-provider';

const directories: string[] = [];
const providers: TestOidcProvider[] = [];

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function notificationBody(): string {
  return JSON.stringify({
    notification: {
      counts: { unread: 1 },
      devices: [
        {
          app_id: 'example.android',
          data: {
            format: 'event_id_only',
            trinity_account_id: 'account-route',
            trinity_push_version: '1',
          },
          pushkey: 'registration-token',
        },
      ],
      event_id: '$event:example.test',
      room_id: '!room:example.test',
    },
  });
}

describe('authentication isolation', () => {
  it('keeps Matrix delivery and public health healthy during provider outage', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'trinity-isolation-'));
    directories.push(directory);
    const provider = await startTestOidcProvider({ profile: 'pocket-id' });
    providers.push(provider);
    const authState = SqliteAuthSpikeHarness.open(
      path.join(directory, 'admin-spike.sqlite'),
    );
    const authenticator = await createOidcAuthenticator(
      {
        callbackUrl: provider.callbackUrl,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        clientSecretMethod: provider.clientSecretMethod,
        groupClaim: 'groups',
        issuer: provider.issuer,
        requiredGroup: 'gateway-operators',
        scopes: ['openid', 'profile', 'email', 'groups'],
      },
      authState,
      { nowSeconds: () => 1_000 },
    );
    const callback = await provider.authorize(await authenticator.beginLogin());
    await provider.close();
    let fcmCalls = 0;
    const config = loadBunConfiguration({
      TRINITY_PUSH_GATEWAY_ANDROID_APP_ID: 'example.android',
      TRINITY_PUSH_GATEWAY_DATABASE_PATH: path.join(
        directory,
        'gateway.sqlite',
      ),
      TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
      TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'private-key',
      TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'example-project',
      TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: 'f'.repeat(32),
      TRINITY_PUSH_GATEWAY_HOST: '127.0.0.1',
      TRINITY_PUSH_GATEWAY_IOS_APP_ID: 'example.ios',
    });
    const runtime = await startBunGateway(
      { ...config, port: 0 },
      canonicalMigrations,
      {
        fcmClient: {
          send() {
            fcmCalls += 1;
            return Promise.resolve({ kind: 'delivered' });
          },
        },
        installSignalHandlers: false,
        log: () => undefined,
      },
    );
    const origin = `http://127.0.0.1:${runtime.port}`;

    const [authFailure, notify, health] = await Promise.all([
      authenticator.completeLogin(callback).catch((error: unknown) => error),
      fetch(`${origin}/_matrix/push/v1/notify`, {
        body: notificationBody(),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      fetch(`${origin}/health`),
    ]);

    expect(authFailure).toMatchObject({
      code: 'provider_response_invalid',
      message: 'OIDC authentication failed.',
    });
    expect(notify.status).toBe(200);
    expect(await notify.json()).toEqual({ rejected: [] });
    expect(fcmCalls).toBe(1);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });
    expect(authState.snapshot()).toEqual({
      identities: [],
      loginAttempts: [],
      sessions: [],
    });

    await runtime.stop();
    authState.close();
  });
});
