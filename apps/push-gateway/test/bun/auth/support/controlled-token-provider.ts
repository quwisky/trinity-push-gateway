import type { Server } from 'bun';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';

export type ControlledTokenFault =
  | 'expired'
  | 'multiple_audiences'
  | 'wrong_audience'
  | 'wrong_issuer'
  | 'wrong_nonce'
  | 'wrong_signature';

export type ControlledTokenProvider = {
  readonly callbackFor: (authorizationUrl: URL) => URL;
  readonly callbackUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly issuer: string;
  readonly stop: () => Promise<void>;
  readonly tokenRequests: () => number;
};

function publicJwk(key: CryptoKey): Promise<JWK> {
  return exportJWK(key).then((jwk) => ({
    ...jwk,
    alg: 'RS256',
    kid: 'contract-key',
    use: 'sig',
  }));
}

export async function startControlledTokenProvider(
  fault: ControlledTokenFault,
): Promise<ControlledTokenProvider> {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const untrusted = await generateKeyPair('RS256', { extractable: true });
  const jwk = await publicJwk(signing.publicKey);
  const clientId = 'controlled-client';
  const clientSecret = 'controlled-client-secret-0000000000';
  const callbackUrl = 'http://127.0.0.1/admin/auth/callback';
  let issuer = '';
  let nonce = '';
  let requestCount = 0;
  const server: Server<undefined> = Bun.serve({
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          authorization_endpoint: `${issuer}/authorize`,
          code_challenge_methods_supported: ['S256'],
          grant_types_supported: ['authorization_code'],
          id_token_signing_alg_values_supported: ['RS256'],
          issuer,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          token_endpoint: `${issuer}/token`,
          token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
      }
      if (url.pathname === '/jwks') {
        return Response.json({ keys: [jwk] });
      }
      if (url.pathname === '/token') {
        requestCount += 1;
        const now = Math.floor(Date.now() / 1_000);
        const audience =
          fault === 'wrong_audience'
            ? 'other-client'
            : fault === 'multiple_audiences'
              ? [clientId, 'other-client']
              : clientId;
        const token = new SignJWT({
          ...(fault === 'multiple_audiences' ? { azp: clientId } : {}),
          groups: ['gateway-operators'],
          nonce: fault === 'wrong_nonce' ? 'wrong-nonce' : nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'contract-key' })
          .setIssuer(fault === 'wrong_issuer' ? `${issuer}/wrong` : issuer)
          .setAudience(audience)
          .setSubject('operator-123')
          .setIssuedAt(now - 1)
          .setExpirationTime(fault === 'expired' ? now - 3_600 : now + 60);
        const idToken = await token.sign(
          fault === 'wrong_signature'
            ? untrusted.privateKey
            : signing.privateKey,
        );
        return Response.json(
          {
            access_token: 'access-token-sentinel',
            expires_in: 60,
            id_token: idToken,
            token_type: 'Bearer',
          },
          { headers: { 'cache-control': 'no-store' } },
        );
      }
      return new Response('not found', { status: 404 });
    },
  });
  issuer = `http://127.0.0.1:${server.port}`;
  return {
    callbackFor(authorizationUrl): URL {
      nonce = authorizationUrl.searchParams.get('nonce') ?? '';
      const callback = new URL(callbackUrl);
      callback.searchParams.set('code', 'controlled-code');
      callback.searchParams.set(
        'state',
        authorizationUrl.searchParams.get('state') ?? '',
      );
      return callback;
    },
    callbackUrl,
    clientId,
    clientSecret,
    issuer,
    stop: () => server.stop(true),
    tokenRequests: () => requestCount,
  };
}
