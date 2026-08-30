import { reserveDailyAttempts } from './budget';
import {
  claimDelivery,
  completeDelivery,
  releaseDelivery,
} from './delivery-store';
import type { Env } from './cloudflare-env';
import type { GatewayStore, SourceLimiter } from './ports';
import {
  BUDGET_COLUMNS,
  DELIVERY_COLUMNS,
  DELIVERY_EXPIRY_INDEX,
  HEALTH_CHECK_DATE,
} from './schema';

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
        const [deliveryInfo, budgetInfo, index, write, cleanup] =
          await database.batch([
            database.prepare(
              "SELECT name FROM pragma_table_info('delivery_records')",
            ),
            database.prepare(
              "SELECT name FROM pragma_table_info('daily_budgets')",
            ),
            database
              .prepare(
                `SELECT COUNT(*) AS count
               FROM sqlite_master
               WHERE type = 'index'
                 AND name = ?1`,
              )
              .bind(DELIVERY_EXPIRY_INDEX),
            database
              .prepare(
                `INSERT INTO daily_budgets (utc_date, attempts)
               VALUES (?1, 0)
               ON CONFLICT (utc_date) DO UPDATE SET attempts = excluded.attempts`,
              )
              .bind(HEALTH_CHECK_DATE),
            database
              .prepare('DELETE FROM daily_budgets WHERE utc_date = ?1')
              .bind(HEALTH_CHECK_DATE),
          ]);
        if (
          deliveryInfo === undefined ||
          budgetInfo === undefined ||
          index === undefined ||
          write === undefined ||
          cleanup === undefined
        ) {
          return false;
        }
        const deliveryColumns = deliveryInfo.results.map(
          (row) => (row as { readonly name: string }).name,
        );
        const budgetColumns = budgetInfo.results.map(
          (row) => (row as { readonly name: string }).name,
        );
        return (
          DELIVERY_COLUMNS.every((name) => deliveryColumns.includes(name)) &&
          BUDGET_COLUMNS.every((name) => budgetColumns.includes(name)) &&
          (index.results[0] as { readonly count?: number } | undefined)
            ?.count === 1
        );
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
    limiter: cloudflareLimiter(env.TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMITER),
    store: d1Store(env.TRINITY_PUSH_GATEWAY_DB),
  };
}
