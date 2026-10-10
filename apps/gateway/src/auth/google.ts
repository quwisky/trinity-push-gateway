import { SignJWT, importPKCS8 } from 'jose';
import type { ServiceAccount } from '../config';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const REFRESH_MARGIN_MS = 300_000;

const JWT_LIFETIME_S = 3600;
const KV_MIN_TTL_S = 60;
const REFRESH_MARGIN_S = REFRESH_MARGIN_MS / 1000;

export interface CachedToken {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface TokenSource {
  getAccessToken(): Promise<string>;
  invalidate(): Promise<void>;
}

/**
 * The token exchange failed. The message never includes the response body,
 * which could echo the signed assertion.
 */
export class TokenExchangeError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TokenExchangeError';
    this.status = status;
  }
}

const sharedMemory = new Map<string, CachedToken>();
/**
 * Access tokens that `invalidate()` dropped, per cache key. Kept in isolate
 * memory so a KV delete that failed cannot hand the same token back.
 */
const sharedRejected = new Map<string, string>();

function isCachedToken(value: unknown): value is CachedToken {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.accessToken === 'string' && typeof v.expiresAt === 'number';
}

export function createGoogleTokenSource(opts: {
  serviceAccount: ServiceAccount;
  kv: KVNamespace;
  memory?: Map<string, CachedToken>;
  rejected?: Map<string, string>;
  now?: () => number;
}): TokenSource {
  const { serviceAccount, kv } = opts;
  const memory = opts.memory ?? sharedMemory;
  const rejected = opts.rejected ?? sharedRejected;
  const now = opts.now ?? Date.now;
  const key = `google-oauth:${serviceAccount.clientEmail}`;

  const isValid = (t: CachedToken): boolean =>
    t.expiresAt - REFRESH_MARGIN_MS > now();

  async function readKv(): Promise<CachedToken | undefined> {
    try {
      const value: unknown = await kv.get(key, 'json');
      return isCachedToken(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async function exchange(): Promise<CachedToken> {
    const issuedAt = Math.floor(now() / 1000);
    let assertion: string;
    try {
      const signingKey = await importPKCS8(serviceAccount.privateKey, 'RS256');
      assertion = await new SignJWT({ scope: FCM_SCOPE })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuer(serviceAccount.clientEmail)
        .setAudience(TOKEN_URL)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + JWT_LIFETIME_S)
        .sign(signingKey);
    } catch {
      throw new TokenExchangeError('could not sign the token assertion');
    }

    let res: Response;
    try {
      res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
      });
    } catch (cause) {
      // A fetch failure carries no secrets, so it is safe to keep as the cause.
      throw new TokenExchangeError('token endpoint request failed', undefined, {
        cause,
      });
    }

    if (!res.ok) {
      throw new TokenExchangeError(
        `token endpoint returned HTTP ${res.status}`,
        res.status,
      );
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const parsed = (body ?? {}) as Record<string, unknown>;
    const { access_token: accessToken, expires_in: expiresIn } = parsed;
    if (
      typeof accessToken !== 'string' ||
      accessToken === '' ||
      typeof expiresIn !== 'number'
    ) {
      throw new TokenExchangeError(
        'token endpoint returned an unexpected response',
        res.status,
      );
    }

    const token: CachedToken = {
      accessToken,
      expiresAt: now() + expiresIn * 1000,
    };
    memory.set(key, token);
    rejected.delete(key);
    try {
      await kv.put(key, JSON.stringify(token), {
        expirationTtl: Math.max(
          KV_MIN_TTL_S,
          Math.floor(expiresIn - REFRESH_MARGIN_S),
        ),
      });
    } catch {
      // KV is only a cache; the token is already usable from memory.
    }
    return token;
  }

  return {
    async getAccessToken() {
      const inMemory = memory.get(key);
      if (inMemory && isValid(inMemory)) return inMemory.accessToken;

      const inKv = await readKv();
      if (inKv && isValid(inKv) && inKv.accessToken !== rejected.get(key)) {
        memory.set(key, inKv);
        return inKv.accessToken;
      }

      return (await exchange()).accessToken;
    },

    async invalidate() {
      const dropped = memory.get(key);
      if (dropped) rejected.set(key, dropped.accessToken);
      memory.delete(key);
      try {
        await kv.delete(key);
      } catch {
        // A failed delete only means the stale entry lives until its TTL.
      }
    },
  };
}
