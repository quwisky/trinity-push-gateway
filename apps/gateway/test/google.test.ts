import { env } from 'cloudflare:workers';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FCM_SCOPE,
  TOKEN_URL,
  TokenExchangeError,
  createGoogleTokenSource,
  type CachedToken,
} from '../src/auth/google';
import { makeServiceAccount } from './helpers/keys';

const NOW = 1_800_000_000_000;
const now = () => NOW;

function tokenResponse(): Response {
  return Response.json({
    access_token: 'tok-1',
    expires_in: 3600,
    token_type: 'Bearer',
  });
}

async function setup() {
  const { serviceAccount, publicKey } = await makeServiceAccount();
  const memory = new Map<string, CachedToken>();
  const rejected = new Map<string, string>();
  const source = createGoogleTokenSource({
    serviceAccount,
    kv: env.TOKENS,
    memory,
    rejected,
    now,
  });
  return { serviceAccount, publicKey, memory, rejected, source };
}

const kvKey = (serviceAccount: { clientEmail: string }) =>
  `google-oauth:${serviceAccount.clientEmail}`;

describe('google token source', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

  beforeEach(() => {
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => tokenResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exchanges a signed JWT on a cold cache', async () => {
    const { serviceAccount, publicKey, source } = await setup();

    await expect(source.getAccessToken()).resolves.toBe('tok-1');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(TOKEN_URL);
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(init?.body as string);
    expect(form.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    const assertion = form.get('assertion')!;
    expect(decodeProtectedHeader(assertion)).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    const { payload } = await jwtVerify(assertion, publicKey, {
      currentDate: new Date(NOW),
    });
    expect(payload).toMatchObject({
      iss: serviceAccount.clientEmail,
      aud: TOKEN_URL,
      scope: FCM_SCOPE,
      iat: 1_800_000_000,
      exp: 1_800_000_000 + 3600,
    });
  });

  it('serves from memory', async () => {
    const { source } = await setup();
    await source.getAccessToken();
    await expect(source.getAccessToken()).resolves.toBe('tok-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('serves from KV', async () => {
    const { serviceAccount, source } = await setup();
    await env.TOKENS.put(
      `google-oauth:${serviceAccount.clientEmail}`,
      JSON.stringify({ accessToken: 'kv-tok', expiresAt: NOW + 3_600_000 }),
    );
    await expect(source.getAccessToken()).resolves.toBe('kv-tok');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes inside the margin', async () => {
    const { serviceAccount, source } = await setup();
    await env.TOKENS.put(
      `google-oauth:${serviceAccount.clientEmail}`,
      JSON.stringify({ accessToken: 'kv-tok', expiresAt: NOW + 60_000 }),
    );
    await expect(source.getAccessToken()).resolves.toBe('tok-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('stores in KV with TTL', async () => {
    const { serviceAccount, source } = await setup();
    const putSpy = vi.spyOn(env.TOKENS, 'put');

    await source.getAccessToken();

    expect(putSpy).toHaveBeenCalledTimes(1);
    const [key, , options] = putSpy.mock.calls[0]!;
    expect(key).toBe(`google-oauth:${serviceAccount.clientEmail}`);
    expect(options).toEqual({ expirationTtl: 3300 });
  });

  it.each([
    ['fractional', 3600.9, 3300],
    ['short', 100, 60],
    ['just above the floor', 361, 61],
  ])(
    'stores a %s expires_in with an integer TTL of at least 60 s',
    async (_name, expiresIn, ttl) => {
      const { source } = await setup();
      fetchSpy.mockImplementation(async () =>
        Response.json({ access_token: 'tok-1', expires_in: expiresIn }),
      );
      const putSpy = vi.spyOn(env.TOKENS, 'put');

      await source.getAccessToken();

      expect(putSpy.mock.calls[0]![2]).toEqual({ expirationTtl: ttl });
    },
  );

  it('promotes a KV hit into memory', async () => {
    const { serviceAccount, memory, source } = await setup();
    const cached = { accessToken: 'kv-tok', expiresAt: NOW + 3_600_000 };
    await env.TOKENS.put(kvKey(serviceAccount), JSON.stringify(cached));
    const getSpy = vi.spyOn(env.TOKENS, 'get');

    await source.getAccessToken();
    await source.getAccessToken();

    expect(memory.get(kvKey(serviceAccount))).toEqual(cached);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'not json'],
    ['a JSON string', '"tok"'],
    ['missing expiresAt', JSON.stringify({ accessToken: 'kv-tok' })],
    [
      'a non-string accessToken',
      JSON.stringify({ accessToken: 7, expiresAt: NOW + 3_600_000 }),
    ],
    [
      'a string expiresAt',
      JSON.stringify({ accessToken: 'kv-tok', expiresAt: 'soon' }),
    ],
  ])('treats a KV value that is %s as a miss', async (_name, value) => {
    const { serviceAccount, source } = await setup();
    await env.TOKENS.put(kvKey(serviceAccount), value);

    await expect(source.getAccessToken()).resolves.toBe('tok-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a successful exchange clears the rejected-token record', async () => {
    const { serviceAccount, memory, rejected, source } = await setup();
    // The token endpoint hands back the very token that was rejected earlier.
    rejected.set(kvKey(serviceAccount), 'tok-1');

    await source.getAccessToken();
    expect(rejected.has(kvKey(serviceAccount))).toBe(false);

    // Without memory the KV copy is the only source, and must be trusted again.
    memory.clear();
    await expect(source.getAccessToken()).resolves.toBe('tok-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('invalidate clears memory and KV', async () => {
    const { source } = await setup();
    await source.getAccessToken();
    await source.invalidate();
    await source.getAccessToken();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  describe('when KV cannot delete the invalidated token', () => {
    async function setupStaleKv() {
      const { serviceAccount } = await makeServiceAccount();
      const kv = {
        get: (...args: Parameters<KVNamespace['get']>) =>
          (env.TOKENS.get as (...a: unknown[]) => unknown)(...args),
        put: () => Promise.reject(new Error('kv down')),
        delete: () => Promise.reject(new Error('kv down')),
      } as unknown as KVNamespace;
      await env.TOKENS.put(
        `google-oauth:${serviceAccount.clientEmail}`,
        JSON.stringify({
          accessToken: 'stale-tok',
          expiresAt: NOW + 3_600_000,
        }),
      );
      const source = createGoogleTokenSource({
        serviceAccount,
        kv,
        memory: new Map<string, CachedToken>(),
        rejected: new Map<string, string>(),
        now,
      });
      return { source };
    }

    it('exchanges a new token instead of re-reading the rejected one', async () => {
      const { source } = await setupStaleKv();
      await expect(source.getAccessToken()).resolves.toBe('stale-tok');
      expect(fetchSpy).not.toHaveBeenCalled();

      await source.invalidate();
      fetchSpy.mockImplementation(async () =>
        Response.json({ access_token: 'fresh-tok', expires_in: 3600 }),
      );

      await expect(source.getAccessToken()).resolves.toBe('fresh-tok');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('serves the new token from memory afterwards', async () => {
      const { source } = await setupStaleKv();
      await source.getAccessToken();
      await source.invalidate();
      fetchSpy.mockImplementation(async () =>
        Response.json({ access_token: 'fresh-tok', expires_in: 3600 }),
      );
      await source.getAccessToken();

      await expect(source.getAccessToken()).resolves.toBe('fresh-tok');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects with TokenExchangeError on an HTTP error', async () => {
    const { source } = await setup();
    fetchSpy.mockResolvedValue(
      new Response('{"error":"boom"}', { status: 500 }),
    );
    const err = await source.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenExchangeError);
    expect((err as TokenExchangeError).status).toBe(500);
    expect((err as Error).message).not.toContain('boom');
  });

  it('rejects with TokenExchangeError on a network error, keeping it as the cause', async () => {
    const { source } = await setup();
    const networkError = new TypeError('network down');
    fetchSpy.mockRejectedValue(networkError);
    const err = await source.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenExchangeError);
    expect((err as TokenExchangeError).cause).toBe(networkError);
  });

  it('rejects with a key-free TokenExchangeError when signing fails', async () => {
    const { serviceAccount } = await makeServiceAccount();
    const badKey = [
      '-----BEGIN PRIVATE KEY-----',
      'SECRETKEYMATERIAL',
      '-----END PRIVATE KEY-----',
      '',
    ].join('\n');
    const source = createGoogleTokenSource({
      serviceAccount: { ...serviceAccount, privateKey: badKey },
      kv: env.TOKENS,
      memory: new Map<string, CachedToken>(),
      rejected: new Map<string, string>(),
      now,
    });

    const err = await source.getAccessToken().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TokenExchangeError);
    expect((err as TokenExchangeError).status).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Neither the message, the stack nor a cause may carry key material.
    expect((err as Error).cause).toBeUndefined();
    const text = `${(err as Error).message}\n${(err as Error).stack}`;
    expect(text).not.toContain('SECRETKEYMATERIAL');
  });

  it('rejects when the response lacks access_token or expires_in', async () => {
    const { source } = await setup();
    fetchSpy.mockResolvedValue(Response.json({ token_type: 'Bearer' }));
    const err = await source.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenExchangeError);
    expect((err as TokenExchangeError).status).toBe(200);
  });

  it('treats a KV failure as a miss', async () => {
    const { serviceAccount, memory } = await setup();
    const kv = {
      get: () => Promise.reject(new Error('kv down')),
      put: () => Promise.reject(new Error('kv down')),
      delete: () => Promise.reject(new Error('kv down')),
    } as unknown as KVNamespace;
    const source = createGoogleTokenSource({
      serviceAccount,
      kv,
      memory,
      now,
    });
    await expect(source.getAccessToken()).resolves.toBe('tok-1');
    await expect(source.invalidate()).resolves.toBeUndefined();
  });
});
