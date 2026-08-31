import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createOidcAuthenticator } from '../../../src/bun/auth/oidc-client';
import {
  SqliteAuthSpikeHarness,
  type AuthWriteFailurePoint,
} from './support/sqlite-auth-spike';
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

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-auth-spike-'));
  directories.push(directory);
  return path.join(directory, 'admin-spike.sqlite');
}

describe('OIDC persistence feasibility', () => {
  it('persists only the typed Operator Identity and opaque session projection', async () => {
    const provider = await startTestOidcProvider({ profile: 'pocket-id' });
    providers.push(provider);
    const file = databasePath();
    const harness = SqliteAuthSpikeHarness.open(file);
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
      harness,
      { nowSeconds: () => 1_000 },
    );
    const callback = await provider.authorize(await authenticator.beginLogin());
    const identity = await authenticator.completeLogin(callback);
    harness.establishSession(identity, {
      id: 'opaque-session-hash',
      nowSeconds: 1_000,
      policyFingerprint: 'policy-fingerprint',
      xsrfToken: 'xsrf-token-hash',
    });
    harness.close();

    const reopened = SqliteAuthSpikeHarness.open(file);
    const snapshot = reopened.snapshot();
    reopened.close();

    expect(snapshot).toEqual({
      identities: [
        {
          displayName: 'Gateway Operator',
          email: 'operator@example.test',
          issuer: provider.issuer,
          subject: 'operator-123',
        },
      ],
      loginAttempts: [],
      sessions: [
        {
          absoluteExpiresAt: 29_800,
          createdAt: 1_000,
          id: 'opaque-session-hash',
          idleExpiresAt: 2_800,
          issuer: provider.issuer,
          policyFingerprint: 'policy-fingerprint',
          revokedAt: null,
          subject: 'operator-123',
          xsrfToken: 'xsrf-token-hash',
        },
      ],
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toMatch(
      /access_token|refresh_token|id_token|raw_claims|groups|nonce|codeVerifier/u,
    );
    expect(serialized).not.toContain(
      callback.searchParams.get('code') ?? 'missing-code',
    );
    expect(serialized).not.toContain(provider.clientSecret);
  });

  it.each([
    'after_identity',
    'after_session',
  ] satisfies readonly AuthWriteFailurePoint[])(
    'rolls back atomically when a write fails %s',
    (failurePoint) => {
      const harness = SqliteAuthSpikeHarness.open(databasePath());

      expect(() => {
        harness.establishSession(
          {
            displayName: 'Operator',
            email: 'operator@example.test',
            issuer: 'https://issuer.example/',
            subject: 'operator-1',
          },
          {
            failurePoint,
            id: 'opaque-session-hash',
            nowSeconds: 1_000,
            policyFingerprint: 'policy-fingerprint',
            xsrfToken: 'xsrf-token-hash',
          },
        );
      }).toThrow('Injected auth write failure.');
      expect(harness.snapshot()).toEqual({
        identities: [],
        loginAttempts: [],
        sessions: [],
      });
      harness.close();
    },
  );

  it('keys identities only by issuer and subject and prunes optional profile data', () => {
    const harness = SqliteAuthSpikeHarness.open(databasePath());
    harness.establishSession(
      {
        displayName: 'Old Name',
        email: 'shared@example.test',
        issuer: 'https://issuer-a.example/',
        subject: 'subject-a',
      },
      {
        id: 'session-a-1',
        nowSeconds: 1,
        policyFingerprint: 'policy',
        xsrfToken: 'xsrf-a-1',
      },
    );
    harness.establishSession(
      {
        email: 'shared@example.test',
        issuer: 'https://issuer-b.example/',
        subject: 'subject-b',
      },
      {
        id: 'session-b-1',
        nowSeconds: 2,
        policyFingerprint: 'policy',
        xsrfToken: 'xsrf-b-1',
      },
    );
    harness.establishSession(
      { issuer: 'https://issuer-a.example/', subject: 'subject-a' },
      {
        id: 'session-a-2',
        nowSeconds: 3,
        policyFingerprint: 'policy',
        xsrfToken: 'xsrf-a-2',
      },
    );

    expect(harness.snapshot().identities).toEqual([
      {
        displayName: null,
        email: null,
        issuer: 'https://issuer-a.example/',
        subject: 'subject-a',
      },
      {
        displayName: null,
        email: 'shared@example.test',
        issuer: 'https://issuer-b.example/',
        subject: 'subject-b',
      },
    ]);
    harness.close();
  });

  it('enforces five-per-identity and 100-global session caps atomically', () => {
    const harness = SqliteAuthSpikeHarness.open(databasePath());
    for (let index = 0; index < 6; index += 1) {
      harness.establishSession(
        { issuer: 'https://issuer.example/', subject: 'capped-operator' },
        {
          id: `identity-session-${index}`,
          nowSeconds: index,
          policyFingerprint: 'policy',
          xsrfToken: `xsrf-${index}`,
        },
      );
    }
    expect(
      harness
        .snapshot()
        .sessions.map(({ id }) => id)
        .filter((id) => id.startsWith('identity-session-')),
    ).toEqual([
      'identity-session-1',
      'identity-session-2',
      'identity-session-3',
      'identity-session-4',
      'identity-session-5',
    ]);

    for (let index = 0; index < 96; index += 1) {
      harness.establishSession(
        {
          issuer: 'https://issuer.example/',
          subject: `global-operator-${index}`,
        },
        {
          id: `global-session-${index.toString().padStart(3, '0')}`,
          nowSeconds: 100 + index,
          policyFingerprint: 'policy',
          xsrfToken: `global-xsrf-${index}`,
        },
      );
    }
    const sessions = harness.snapshot().sessions;
    expect(sessions).toHaveLength(100);
    expect(sessions.some(({ id }) => id === 'identity-session-1')).toBe(false);
    expect(sessions.at(-1)?.id).toBe('global-session-095');
    harness.close();
  });
});
