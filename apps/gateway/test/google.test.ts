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
  const source = createGoogleTokenSource({
    serviceAccount,
    kv: env.TOKENS,
    memory,
    now,
  });
  return { serviceAccount, publicKey, memory, source };
}

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

  it('invalidate clears memory and KV', async () => {
    const { source } = await setup();
    await source.getAccessToken();
    await source.invalidate();
    await source.getAccessToken();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

  it('rejects with TokenExchangeError on a network error', async () => {
    const { source } = await setup();
    fetchSpy.mockRejectedValue(new TypeError('network down'));
    await expect(source.getAccessToken()).rejects.toBeInstanceOf(
      TokenExchangeError,
    );
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
