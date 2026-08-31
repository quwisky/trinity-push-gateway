import type { Server } from 'bun';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import type { TestOidcProvider } from '../auth/support/test-oidc-provider';

const CALLBACK_URL = 'http://127.0.0.1/admin/auth/callback';
const CLIENT_ID = 'malformed-logout-client';
const CLIENT_SECRET = 'malformed-logout-client-secret-000000';

export async function startMalformedLogoutProvider(): Promise<TestOidcProvider> {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const jwk = {
    ...(await exportJWK(signing.publicKey)),
    alg: 'RS256',
    kid: 'malformed-logout-key',
    use: 'sig',
  };
  let issuer = '';
  let nonce = '';
  const server: Server<undefined> = Bun.serve({
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/.well-known/openid-configuration') {
        return Response.json({
          authorization_endpoint: `${issuer}/authorize`,
          code_challenge_methods_supported: ['S256'],
          end_session_endpoint: 'not a url',
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
        const now = Math.floor(Date.now() / 1_000);
        const idToken = await new SignJWT({
          email: 'operator@example.test',
          groups: ['gateway-operators'],
          name: 'Gateway Operator',
          nonce,
        })
          .setProtectedHeader({ alg: 'RS256', kid: 'malformed-logout-key' })
          .setIssuer(issuer)
          .setAudience(CLIENT_ID)
          .setSubject('operator-123')
          .setIssuedAt(now - 1)
          .setExpirationTime(now + 60)
          .sign(signing.privateKey);
        return Response.json(
          {
            access_token: 'test-only-access-token',
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
  const ready = {
    callbackUrl: CALLBACK_URL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    clientSecretMethod: 'client_secret_basic' as const,
    issuer,
    postLogoutUrl: 'http://127.0.0.1/admin/',
    profile: 'pocket-id' as const,
    type: 'ready' as const,
  };
  let closed = false;
  return {
    ...ready,
    authorize(authorizationUrl): Promise<URL> {
      nonce = authorizationUrl.searchParams.get('nonce') ?? '';
      const callback = new URL(CALLBACK_URL);
      callback.searchParams.set('code', 'malformed-logout-code');
      callback.searchParams.set(
        'state',
        authorizationUrl.searchParams.get('state') ?? '',
      );
      return Promise.resolve(callback);
    },
    async close(): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      await server.stop(true);
    },
    events: [ready],
  };
}
