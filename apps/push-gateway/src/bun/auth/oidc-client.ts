import { createHash } from 'node:crypto';

import {
  ClientSecretBasic,
  ClientSecretPost,
  allowInsecureRequests,
  authorizationCodeGrant,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  calculatePKCECodeChallenge,
  discovery,
  enableNonRepudiationChecks,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
  type Configuration,
} from 'openid-client';
import * as z from 'zod/mini';

const IDENTITY_CLAIMS_SCHEMA = z.looseObject({
  aud: z.union([z.string(), z.array(z.string())]),
  email: z.optional(z.string().check(z.maxLength(320))),
  iss: z.string(),
  name: z.optional(z.string().check(z.maxLength(256))),
  sub: z.string().check(z.minLength(1), z.maxLength(256)),
});
const GROUPS_SCHEMA = z.array(z.string().check(z.maxLength(256)));

export const OPERATOR_AUTH_PATHS = {
  callback: '/admin/auth/callback',
  login: '/admin/auth/login',
  logout: '/admin/auth/logout',
} as const;

export type OidcLoginAttempt = {
  readonly codeVerifier: string;
  readonly expiresAt: number;
  readonly nonce: string;
  readonly stateDigest: string;
};

export type OidcLoginAttemptStore = {
  readonly consume: (
    stateDigest: string,
    nowSeconds: number,
  ) => Promise<OidcLoginAttempt | undefined>;
  readonly save: (attempt: OidcLoginAttempt) => Promise<void>;
};

export type OidcClientSettings = {
  readonly callbackUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly clientSecretMethod: 'client_secret_basic' | 'client_secret_post';
  readonly groupClaim: string;
  readonly issuer: string;
  readonly requiredGroup: string;
  readonly scopes: readonly string[];
};

type OidcAuthenticatorOptions = {
  readonly nowSeconds?: () => number;
};

export type OidcAuthenticator = {
  readonly beginLogin: () => Promise<URL>;
  readonly buildProviderLogoutUrl: () => URL | undefined;
  readonly completeLogin: (
    callbackUrl: URL,
  ) => Promise<OperatorIdentityProjection>;
};

export type OperatorIdentityProjection = {
  readonly displayName?: string;
  readonly email?: string;
  readonly issuer: string;
  readonly subject: string;
};

export class OidcAuthenticationError extends Error {
  constructor(
    readonly code:
      | 'login_state_invalid'
      | 'provider_response_invalid'
      | 'required_group_missing',
  ) {
    super('OIDC authentication failed.');
    this.name = 'OidcAuthenticationError';
  }
}

export class OidcConfigurationError extends Error {
  constructor() {
    super('OIDC configuration is invalid.');
    this.name = 'OidcConfigurationError';
  }
}

function isLoopback(url: URL): boolean {
  return (
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === 'localhost'
  );
}

function validEndpointUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      url.username !== '' ||
      url.password !== '' ||
      url.hash !== '' ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && isLoopback(url)))
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function isClientSecretMethod(
  value: unknown,
): value is OidcClientSettings['clientSecretMethod'] {
  return value === 'client_secret_basic' || value === 'client_secret_post';
}

function validateSettings(settings: OidcClientSettings): void {
  const issuer = validEndpointUrl(settings.issuer);
  const callback = validEndpointUrl(settings.callbackUrl);
  const uniqueScopes = new Set(settings.scopes);
  if (
    issuer === undefined ||
    callback === undefined ||
    issuer.search !== '' ||
    callback.search !== '' ||
    settings.clientId.length === 0 ||
    settings.clientSecret.length === 0 ||
    !isClientSecretMethod(settings.clientSecretMethod) ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(settings.groupClaim) ||
    settings.requiredGroup.length === 0 ||
    settings.requiredGroup.length > 256 ||
    settings.scopes.length === 0 ||
    uniqueScopes.size !== settings.scopes.length ||
    !uniqueScopes.has('openid') ||
    uniqueScopes.has('offline_access') ||
    settings.scopes.some((scope) => scope.length === 0 || /\s/u.test(scope))
  ) {
    throw new OidcConfigurationError();
  }
}

function digestState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function hasExactAudience(
  audience: string | readonly string[],
  clientId: string,
): boolean {
  return typeof audience === 'string'
    ? audience === clientId
    : audience.length === 1 && audience[0] === clientId;
}

async function discoverConfiguration(
  settings: OidcClientSettings,
): Promise<Configuration> {
  const issuer = new URL(settings.issuer);
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Used only for loopback-only development and contract tests.
  const loopbackInsecureExtension = allowInsecureRequests;
  const execute = [
    enableNonRepudiationChecks,
    ...(issuer.protocol === 'http:' && isLoopback(issuer)
      ? [loopbackInsecureExtension]
      : []),
  ];
  const clientAuthentication =
    settings.clientSecretMethod === 'client_secret_basic'
      ? ClientSecretBasic(settings.clientSecret)
      : ClientSecretPost(settings.clientSecret);
  const configuration = await discovery(
    issuer,
    settings.clientId,
    {
      client_secret: settings.clientSecret,
      redirect_uris: [settings.callbackUrl],
      response_types: ['code'],
      token_endpoint_auth_method: settings.clientSecretMethod,
    },
    clientAuthentication,
    { execute, timeout: 5 },
  );
  const serverMetadata = configuration.serverMetadata();
  if (
    !serverMetadata.code_challenge_methods_supported?.includes('S256') ||
    (serverMetadata.token_endpoint_auth_methods_supported === undefined
      ? settings.clientSecretMethod !== 'client_secret_basic'
      : !serverMetadata.token_endpoint_auth_methods_supported.includes(
          settings.clientSecretMethod,
        ))
  ) {
    throw new OidcConfigurationError();
  }
  return configuration;
}

export async function createOidcAuthenticator(
  settings: OidcClientSettings,
  attempts: OidcLoginAttemptStore,
  options: OidcAuthenticatorOptions = {},
): Promise<OidcAuthenticator> {
  validateSettings(settings);
  const configuredCallback = new URL(settings.callbackUrl);
  const configuration = await discoverConfiguration(settings);
  const nowSeconds =
    options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  return {
    async beginLogin(): Promise<URL> {
      const codeVerifier = randomPKCECodeVerifier();
      const nonce = randomNonce();
      const state = randomState();
      const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
      await attempts.save({
        codeVerifier,
        expiresAt: nowSeconds() + 5 * 60,
        nonce,
        stateDigest: digestState(state),
      });
      return buildAuthorizationUrl(configuration, {
        client_id: settings.clientId,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        nonce,
        redirect_uri: settings.callbackUrl,
        response_type: 'code',
        scope: settings.scopes.join(' '),
        state,
      });
    },
    async completeLogin(callbackUrl): Promise<OperatorIdentityProjection> {
      if (
        callbackUrl.origin !== configuredCallback.origin ||
        callbackUrl.pathname !== configuredCallback.pathname ||
        callbackUrl.username !== '' ||
        callbackUrl.password !== '' ||
        callbackUrl.hash !== ''
      ) {
        throw new OidcAuthenticationError('login_state_invalid');
      }
      const state = callbackUrl.searchParams.get('state');
      if (state === null) {
        throw new OidcAuthenticationError('login_state_invalid');
      }
      const now = nowSeconds();
      const attempt = await attempts.consume(digestState(state), now);
      if (attempt === undefined || now >= attempt.expiresAt) {
        throw new OidcAuthenticationError('login_state_invalid');
      }
      try {
        const tokenResponse = await authorizationCodeGrant(
          configuration,
          callbackUrl,
          {
            expectedNonce: attempt.nonce,
            expectedState: state,
            idTokenExpected: true,
            pkceCodeVerifier: attempt.codeVerifier,
          },
        );
        const claimsResult = z.safeParse(
          IDENTITY_CLAIMS_SCHEMA,
          tokenResponse.claims(),
        );
        if (!claimsResult.success) {
          throw new OidcAuthenticationError('provider_response_invalid');
        }
        const claims = claimsResult.data;
        const expectedIssuer = configuration.serverMetadata().issuer;
        if (
          claims.iss !== expectedIssuer ||
          !hasExactAudience(claims.aud, settings.clientId)
        ) {
          throw new OidcAuthenticationError('provider_response_invalid');
        }
        const groupsResult = z.safeParse(
          GROUPS_SCHEMA,
          claims[settings.groupClaim],
        );
        if (
          !groupsResult.success ||
          !groupsResult.data.includes(settings.requiredGroup)
        ) {
          throw new OidcAuthenticationError('required_group_missing');
        }
        return {
          ...(claims.name === undefined ? {} : { displayName: claims.name }),
          ...(claims.email === undefined ? {} : { email: claims.email }),
          issuer: claims.iss,
          subject: claims.sub,
        };
      } catch (error) {
        if (error instanceof OidcAuthenticationError) {
          throw error;
        }
        throw new OidcAuthenticationError('provider_response_invalid');
      }
    },
    buildProviderLogoutUrl(): URL | undefined {
      return configuration.serverMetadata().end_session_endpoint === undefined
        ? undefined
        : buildEndSessionUrl(configuration);
    },
  };
}
