import { reserveDailyAttempts } from './budget';
import {
  claimDelivery,
  completeDelivery,
  releaseDelivery,
} from './delivery-store';
import type { Env } from './cloudflare-env';
import type { GatewayStore, SourceLimiter } from './ports';

function d1Store(database: D1Database): GatewayStore {
  return {
    claimDelivery: (identity, fingerprintKey, nowSeconds, leaseSeconds) =>
      claimDelivery(
        database,
        identity,
        fingerprintKey,
        nowSeconds,
        leaseSeconds,
      ),
    async cleanup(nowSeconds, utcDate) {
      await database.batch([
        database
          .prepare('DELETE FROM delivery_records WHERE expires_at <= ?1')
          .bind(nowSeconds),
        database
          .prepare('DELETE FROM daily_budgets WHERE utc_date < ?1')
          .bind(utcDate),
      ]);
    },
    completeDelivery: (fingerprint, outcome, reasonCategory, expiresAt) =>
      completeDelivery(
        database,
        fingerprint,
        outcome,
        reasonCategory,
        expiresAt,
      ),
    async ready() {
      try {
        const row = await database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM sqlite_master
             WHERE type = 'table'
               AND name IN ('daily_budgets', 'delivery_records')`,
          )
          .first<{ readonly count: number }>();
        return row?.count === 2;
      } catch {
        return false;
      }
    },
    releaseDelivery: (fingerprint) => releaseDelivery(database, fingerprint),
    reserveDailyAttempts: (utcDate, requestedAttempts, maximumAttempts) =>
      reserveDailyAttempts(
        database,
        utcDate,
        requestedAttempts,
        maximumAttempts,
      ),
  };
}

function cloudflareLimiter(binding: RateLimit): SourceLimiter {
  return {
    async limit(key) {
      const result = await binding.limit({ key });
      return { retryAfterSeconds: 10, success: result.success };
    },
  };
}

export function cloudflareRuntime(env: Env): {
  readonly limiter: SourceLimiter;
  readonly store: GatewayStore;
} {
  return {
    limiter: cloudflareLimiter(env.SOURCE_RATE_LIMITER),
    store: d1Store(env.DB),
  };
}
