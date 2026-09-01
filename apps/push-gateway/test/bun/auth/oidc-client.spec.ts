import { afterEach, describe, expect, it } from 'bun:test';
import type { Server } from 'bun';

import {
  createOidcAuthenticator,
  OPERATOR_AUTH_PATHS,
  OidcAuthenticationError,
  OidcConfigurationError,
  type OidcClientSettings,
  type OidcLoginAttempt,
  type OidcLoginAttemptStore,
} from '../../../src/bun/auth/oidc-client';
import {
  startControlledTokenProvider,
  type ControlledTokenFault,
} from './support/controlled-token-provider';
import {
  startTestOidcProvider,
  type TestOidcProvider,
  type TestProviderProfile,
} from './support/test-oidc-provider';

class RecordingAttemptStore implements OidcLoginAttemptStore {
  readonly attempts: OidcLoginAttempt[] = [];

  consume(): Promise<OidcLoginAttempt | undefined> {
    return Promise.resolve(undefined);
  }

  save(attempt: OidcLoginAttempt): Promise<void> {
    this.attempts.push(attempt);
    return Promise.resolve();
  }
}

class AtomicAttemptStore implements OidcLoginAttemptStore {
  readonly attempts = new Map<string, OidcLoginAttempt>();

  consume(
    stateDigest: string,
    nowSeconds: number,
  ): Promise<OidcLoginAttempt | undefined> {
    const attempt = this.attempts.get(stateDigest);
    this.attempts.delete(stateDigest);
    return Promise.resolve(
      attempt !== undefined && nowSeconds < attempt.expiresAt
        ? attempt
        : undefined,
    );
  }

  save(attempt: OidcLoginAttempt): Promise<void> {
    this.attempts.set(attempt.stateDigest, attempt);
    return Promise.resolve();
  }
}

class NonValidatingAttemptStore implements OidcLoginAttemptStore {
  private attempt: OidcLoginAttempt | undefined;

  consume(): Promise<OidcLoginAttempt | undefined> {
    return Promise.resolve(this.attempt);
  }

  save(attempt: OidcLoginAttempt): Promise<void> {
    this.attempt = attempt;
    return Promise.resolve();
  }
}

const servers: Server<undefined>[] = [];
const providers: TestOidcProvider[] = [];

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject.');
}

afterEach(async () => {
  await Promise.all([
    ...servers.splice(0).map((server) => server.stop(true)),
    ...providers.splice(0).map((provider) => provider.close()),
  ]);
});

function startDiscoveryServer(
  options: {
    readonly clientAuthMethods?: readonly string[];
    readonly pkceMethods?: readonly string[];
  } = {},
): {
  readonly issuer: string;
  readonly callbackUrl: string;
} {
  let issuer = '';
  const server = Bun.serve({
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url);
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          authorization_endpoint: `${issuer}/authorize`,
          code_challenge_methods_supported: options.pkceMethods ?? ['S256'],
          end_session_endpoint: `${issuer}/logout`,
          grant_types_supported: ['authorization_code'],
          id_token_signing_alg_values_supported: ['RS256'],
          issuer,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          token_endpoint: `${issuer}/token`,
          token_endpoint_auth_methods_supported: [
            ...(options.clientAuthMethods ?? [
              'client_secret_basic',
              'client_secret_post',
            ]),
          ],
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  servers.push(server);
  issuer = `http://127.0.0.1:${server.port}`;
  return {
    callbackUrl: `${issuer}/admin/auth/callback`,
    issuer,
  };
}

describe('OIDC authenticator', () => {
  it('reserves only the three fixed authentication paths', () => {
    expect(OPERATOR_AUTH_PATHS).toEqual({
      callback: '/admin/auth/callback',
      login: '/admin/auth/login',
      logout: '/admin/auth/logout',
    });
  });

  it('starts confidential authorization-code login with S256, state, and nonce', async () => {
    const provider = startDiscoveryServer();
    const attempts = new RecordingAttemptStore();
    const authenticator = await createOidcAuthenticator(
      {
        callbackUrl: provider.callbackUrl,
        clientId: 'gateway-client',
        clientSecret: 'client-secret-sentinel',
        clientSecretMethod: 'client_secret_basic',
        groupClaim: 'groups',
        issuer: provider.issuer,
        requiredGroup: 'gateway-operators',
        scopes: ['openid', 'profile', 'email', 'groups'],
      },
      attempts,
      { nowSeconds: () => 1_000 },
    );

    const first = await authenticator.beginLogin();
    const second = await authenticator.beginLogin();

    expect(first.pathname).toBe('/authorize');
    expect(first.searchParams.get('response_type')).toBe('code');
    expect(first.searchParams.get('redirect_uri')).toBe(provider.callbackUrl);
    expect(first.searchParams.get('scope')).toBe('openid profile email groups');
    expect(first.searchParams.get('code_challenge_method')).toBe('S256');
    expect(first.searchParams.get('code_challenge')).toHaveLength(43);
    expect(first.searchParams.get('nonce')).toHaveLength(43);
    expect(first.searchParams.get('state')).toHaveLength(43);
    expect(first.href).not.toContain('client-secret-sentinel');
    expect(second.searchParams.get('state')).not.toBe(
      first.searchParams.get('state'),
    );
    expect(attempts.attempts).toHaveLength(2);
    expect(attempts.attempts[0]).toMatchObject({
      expiresAt: 1_300,
      nonce: first.searchParams.get('nonce'),
    });
    expect(attempts.attempts[0]?.stateDigest).not.toBe(
      first.searchParams.get('state'),
    );
    expect(attempts.attempts[0]?.stateDigest).toHaveLength(64);
    expect(attempts.attempts[0]?.codeVerifier).not.toBe(
      first.searchParams.get('code_challenge'),
    );
  });

  it.each([
    [
      'Pocket ID',
      'pocket-id',
      ['openid', 'profile', 'email', 'groups'],
      'client_secret_basic',
    ],
    [
      'Authentik',
      'authentik',
      ['openid', 'profile', 'email'],
      'client_secret_post',
    ],
  ] satisfies readonly [
    string,
    TestProviderProfile,
    readonly string[],
    'client_secret_basic' | 'client_secret_post',
  ][])(
    'completes a token-private %s authorization-code login',
    async (_name, profile, scopes, clientSecretMethod) => {
      const provider = await startTestOidcProvider({
        clientSecretMethod,
        profile,
      });
      providers.push(provider);
      const attempts = new AtomicAttemptStore();
      const authenticator = await createOidcAuthenticator(
        {
          callbackUrl: provider.callbackUrl,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          clientSecretMethod: provider.clientSecretMethod,
          groupClaim: 'groups',
          issuer: provider.issuer,
          requiredGroup: 'gateway-operators',
          scopes,
        },
        attempts,
        { nowSeconds: () => 1_000 },
      );

      const callback = await provider.authorize(
        await authenticator.beginLogin(),
      );
      const identity = await authenticator.completeLogin(callback);

      expect(identity).toEqual({
        displayName: 'Gateway Operator',
        email: 'operator@example.test',
        issuer: provider.issuer,
        subject: 'operator-123',
      });
      expect(Object.keys(identity).sort()).toEqual([
        'displayName',
        'email',
        'issuer',
        'subject',
      ]);
      expect(JSON.stringify(identity)).not.toMatch(
        /access_token|id_token|refresh_token|gateway-contract-client/u,
      );
      expect(attempts.attempts.size).toBe(0);
      expect(
        provider.events
          .filter((event) => event.type === 'prompt')
          .map((event) => event.name),
      ).toEqual(['login', 'consent']);
    },
  );

  it.each([
    ['missing group claim', 'missing-group'],
    ['wrong group membership', 'wrong-group'],
  ] as const)('rejects %s before exposing an identity', async (_name, mode) => {
    const provider = await startTestOidcProvider({
      mode,
      profile: 'pocket-id',
    });
    providers.push(provider);
    const attempts = new AtomicAttemptStore();
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
      attempts,
      { nowSeconds: () => 1_000 },
    );
    const callback = await provider.authorize(await authenticator.beginLogin());

    expect(
      await rejectionOf(authenticator.completeLogin(callback)),
    ).toMatchObject({
      code: 'required_group_missing',
      message: 'OIDC authentication failed.',
    });
    expect(attempts.attempts.size).toBe(0);
  });

  it('supports an Operator Identity without optional profile claims', async () => {
    const provider = await startTestOidcProvider({
      mode: 'no-profile',
      profile: 'authentik',
    });
    providers.push(provider);
    const authenticator = await createOidcAuthenticator(
      {
        callbackUrl: provider.callbackUrl,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        clientSecretMethod: provider.clientSecretMethod,
        groupClaim: 'groups',
        issuer: provider.issuer,
        requiredGroup: 'gateway-operators',
        scopes: ['openid', 'profile', 'email'],
      },
      new AtomicAttemptStore(),
      { nowSeconds: () => 1_000 },
    );

    const callback = await provider.authorize(await authenticator.beginLogin());
    expect(await authenticator.completeLogin(callback)).toEqual({
      issuer: provider.issuer,
      subject: 'operator-123',
    });
  });

  it('atomically consumes a login attempt before concurrent code exchange', async () => {
    const provider = await startTestOidcProvider({ profile: 'pocket-id' });
    providers.push(provider);
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
      new AtomicAttemptStore(),
      { nowSeconds: () => 1_000 },
    );
    const callback = await provider.authorize(await authenticator.beginLogin());

    const results = await Promise.allSettled([
      authenticator.completeLogin(callback),
      authenticator.completeLogin(callback),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      reason: new OidcAuthenticationError('login_state_invalid'),
      status: 'rejected',
    });
  });

  it('burns state and returns a sanitized failure when the provider is unavailable', async () => {
    const provider = await startTestOidcProvider({ profile: 'pocket-id' });
    providers.push(provider);
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
      new AtomicAttemptStore(),
      { nowSeconds: () => 1_000 },
    );
    const callback = await provider.authorize(await authenticator.beginLogin());
    await provider.close();

    let failure: unknown;
    try {
      await authenticator.completeLogin(callback);
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(
      new OidcAuthenticationError('provider_response_invalid'),
    );
    expect(String(failure)).not.toContain(
      callback.searchParams.get('code') ?? 'missing-code',
    );
    expect(String(failure)).not.toContain(provider.clientSecret);
    expect(
      await rejectionOf(authenticator.completeLogin(callback)),
    ).toMatchObject({
      code: 'login_state_invalid',
    });
  });

  it('expires and burns a login attempt at exactly five minutes', async () => {
    const provider = startDiscoveryServer();
    const attempts = new AtomicAttemptStore();
    let nowSeconds = 1_000;
    const authenticator = await createOidcAuthenticator(
      {
        callbackUrl: provider.callbackUrl,
        clientId: 'gateway-client',
        clientSecret: 'client-secret-sentinel',
        clientSecretMethod: 'client_secret_post',
        groupClaim: 'groups',
        issuer: provider.issuer,
        requiredGroup: 'gateway-operators',
        scopes: ['openid', 'groups'],
      },
      attempts,
      { nowSeconds: () => nowSeconds },
    );
    const authorizationUrl = await authenticator.beginLogin();
    const state = authorizationUrl.searchParams.get('state');
    nowSeconds = 1_300;
    const callback = new URL(provider.callbackUrl);
    callback.searchParams.set('code', 'must-not-be-exchanged');
    callback.searchParams.set('state', state ?? 'missing');

    expect(
      await rejectionOf(authenticator.completeLogin(callback)),
    ).toMatchObject({
      code: 'login_state_invalid',
    });
    expect(
      await rejectionOf(authenticator.completeLogin(callback)),
    ).toMatchObject({
      code: 'login_state_invalid',
    });
    expect(attempts.attempts.size).toBe(0);
  });

  it('rejects an expired attempt even when the store returns it', async () => {
    const provider = startDiscoveryServer();
    let nowSeconds = 1_000;
    const authenticator = await createOidcAuthenticator(
      {
        callbackUrl: provider.callbackUrl,
        clientId: 'gateway-client',
        clientSecret: 'client-secret-sentinel',
        clientSecretMethod: 'client_secret_basic',
        groupClaim: 'groups',
        issuer: provider.issuer,
        requiredGroup: 'gateway-operators',
        scopes: ['openid', 'groups'],
      },
      new NonValidatingAttemptStore(),
      { nowSeconds: () => nowSeconds },
    );
    const authorizationUrl = await authenticator.beginLogin();
    nowSeconds = 1_300;
    const callback = new URL(provider.callbackUrl);
    callback.searchParams.set('code', 'must-not-be-exchanged');
    callback.searchParams.set(
      'state',
      authorizationUrl.searchParams.get('state') ?? 'missing',
    );

    expect(
      await rejectionOf(authenticator.completeLogin(callback)),
    ).toMatchObject({ code: 'login_state_invalid' });
  });

  it('rejects callback origins and paths other than the configured endpoint', async () => {
    const provider = startDiscoveryServer();
    const attempts = new AtomicAttemptStore();
    const authenticator = await createOidcAuthenticator(
      {
        callbackUrl: provider.callbackUrl,
        clientId: 'gateway-client',
        clientSecret: 'client-secret-sentinel',
        clientSecretMethod: 'client_secret_basic',
        groupClaim: 'groups',
        issuer: provider.issuer,
        requiredGroup: 'gateway-operators',
        scopes: ['openid', 'groups'],
      },
      attempts,
    );
    const authorizationUrl = await authenticator.beginLogin();
    const callbacks = [
      new URL('/admin/auth/callback', 'https://attacker.example'),
      new URL('/admin/auth/callback-suffix', provider.issuer),
    ];
    for (const callback of callbacks) {
      callback.searchParams.set('code', 'must-not-be-exchanged');
      callback.searchParams.set(
        'state',
        authorizationUrl.searchParams.get('state') ?? 'missing',
      );

      expect(
        await rejectionOf(authenticator.completeLogin(callback)),
      ).toMatchObject({ code: 'login_state_invalid' });
    }
    expect(attempts.attempts.size).toBe(1);
  });

  it('builds token-free best-effort provider logout from discovery', async () => {
    const provider = startDiscoveryServer();
    const authenticator = await createOidcAuthenticator(
      {
        callbackUrl: provider.callbackUrl,
        clientId: 'gateway-client',
        clientSecret: 'client-secret-sentinel',
        clientSecretMethod: 'client_secret_basic',
        groupClaim: 'groups',
        issuer: provider.issuer,
        requiredGroup: 'gateway-operators',
        scopes: ['openid', 'groups'],
      },
      new AtomicAttemptStore(),
    );

    const logoutUrl = authenticator.buildProviderLogoutUrl();

    expect(logoutUrl?.href).toBe(
      `${provider.issuer}/logout?client_id=gateway-client`,
    );
    expect(logoutUrl?.searchParams.has('id_token_hint')).toBe(false);
    expect(logoutUrl?.searchParams.has('post_logout_redirect_uri')).toBe(false);
  });

  it.each([
    ['offline access', { scopes: ['openid', 'offline_access'] }],
    ['a callback query', { callbackUrl: 'http://127.0.0.1/callback?x=1' }],
    ['non-loopback HTTP', { issuer: 'http://issuer.example/' }],
    ['a nested group claim', { groupClaim: 'realm.groups' }],
  ] satisfies readonly [string, Record<string, unknown>][])(
    'rejects unsafe OIDC configuration with %s',
    async (_name, override) => {
      const provider = startDiscoveryServer();
      const creation = createOidcAuthenticator(
        {
          callbackUrl: provider.callbackUrl,
          clientId: 'gateway-client',
          clientSecret: 'client-secret-sentinel',
          clientSecretMethod: 'client_secret_basic',
          groupClaim: 'groups',
          issuer: provider.issuer,
          requiredGroup: 'gateway-operators',
          scopes: ['openid', 'groups'],
          ...override,
        },
        new AtomicAttemptStore(),
      );

      const failure = await rejectionOf(creation);
      expect(failure).toEqual(new OidcConfigurationError());
      expect(String(failure)).not.toContain('client-secret-sentinel');
    },
  );

  it('rejects an unsupported runtime client authentication method', async () => {
    const provider = startDiscoveryServer();
    const settings: OidcClientSettings = {
      callbackUrl: provider.callbackUrl,
      clientId: 'gateway-client',
      clientSecret: 'client-secret-sentinel',
      clientSecretMethod: 'client_secret_basic',
      groupClaim: 'groups',
      issuer: provider.issuer,
      requiredGroup: 'gateway-operators',
      scopes: ['openid', 'groups'],
    };
    Reflect.set(settings, 'clientSecretMethod', 'private_key_jwt');

    expect(
      await rejectionOf(
        createOidcAuthenticator(settings, new AtomicAttemptStore()),
      ),
    ).toEqual(new OidcConfigurationError());
  });

  it('rejects a provider that does not advertise PKCE S256', async () => {
    const provider = startDiscoveryServer({ pkceMethods: ['plain'] });

    expect(
      await rejectionOf(
        createOidcAuthenticator(
          {
            callbackUrl: provider.callbackUrl,
            clientId: 'gateway-client',
            clientSecret: 'client-secret-sentinel',
            clientSecretMethod: 'client_secret_basic',
            groupClaim: 'groups',
            issuer: provider.issuer,
            requiredGroup: 'gateway-operators',
            scopes: ['openid', 'groups'],
          },
          new AtomicAttemptStore(),
        ),
      ),
    ).toEqual(new OidcConfigurationError());
  });

  it('rejects an unadvertised confidential client authentication method', async () => {
    const provider = startDiscoveryServer({
      clientAuthMethods: ['client_secret_basic'],
    });

    expect(
      await rejectionOf(
        createOidcAuthenticator(
          {
            callbackUrl: provider.callbackUrl,
            clientId: 'gateway-client',
            clientSecret: 'client-secret-sentinel',
            clientSecretMethod: 'client_secret_post',
            groupClaim: 'groups',
            issuer: provider.issuer,
            requiredGroup: 'gateway-operators',
            scopes: ['openid', 'groups'],
          },
          new AtomicAttemptStore(),
        ),
      ),
    ).toEqual(new OidcConfigurationError());
  });

  it.each([
    'expired',
    'multiple_audiences',
    'wrong_audience',
    'wrong_issuer',
    'wrong_nonce',
    'wrong_signature',
  ] satisfies readonly ControlledTokenFault[])(
    'rejects a verified-claim fault: %s',
    async (fault) => {
      const provider = await startControlledTokenProvider(fault);
      try {
        const authenticator = await createOidcAuthenticator(
          {
            callbackUrl: provider.callbackUrl,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
            clientSecretMethod: 'client_secret_basic',
            groupClaim: 'groups',
            issuer: provider.issuer,
            requiredGroup: 'gateway-operators',
            scopes: ['openid', 'groups'],
          },
          new AtomicAttemptStore(),
        );
        const callback = provider.callbackFor(await authenticator.beginLogin());

        expect(
          await rejectionOf(authenticator.completeLogin(callback)),
        ).toMatchObject({
          code: 'provider_response_invalid',
          message: 'OIDC authentication failed.',
        });
        expect(provider.tokenRequests()).toBe(1);
      } finally {
        await provider.stop();
      }
    },
  );
});
