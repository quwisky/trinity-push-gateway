import { eq, lt, lte, sql } from 'drizzle-orm';

import { reserveDailyAttempts } from './budget';
import { createGatewayD1Database } from './d1-database';
import {
  claimDelivery,
  completeDelivery,
  releaseDelivery,
} from './delivery-store';
import type { Env } from './cloudflare-env';
import type { GatewayStore, SourceLimiter } from './ports';
import {
  BUDGET_COLUMNS,
  dailyBudgets,
  DELIVERY_COLUMNS,
  DELIVERY_EXPIRY_INDEX,
  deliveryRecords,
  HEALTH_CHECK_DATE,
} from './schema';

function d1Store(database: D1Database): GatewayStore {
  const queryDatabase = createGatewayD1Database(database);
  return {
    claimDelivery: (identity, fingerprintKey, nowSeconds, leaseSeconds) =>
      claimDelivery(
        queryDatabase,
        identity,
        fingerprintKey,
        nowSeconds,
        leaseSeconds,
      ),
    async cleanup(nowSeconds, utcDate) {
      await queryDatabase.batch([
        queryDatabase
          .delete(deliveryRecords)
          .where(lte(deliveryRecords.expiresAt, nowSeconds)),
        queryDatabase
          .delete(dailyBudgets)
          .where(lt(dailyBudgets.utcDate, utcDate)),
      ]);
    },
    completeDelivery: (fingerprint, outcome, reasonCategory, expiresAt) =>
      completeDelivery(
        queryDatabase,
        fingerprint,
        outcome,
        reasonCategory,
        expiresAt,
      ),
    async ready() {
      try {
        const [deliveryInfo, budgetInfo, index] = await queryDatabase.batch([
          queryDatabase
            .select({ name: sql<string>`name` })
            .from(sql`pragma_table_info('delivery_records')`),
          queryDatabase
            .select({ name: sql<string>`name` })
            .from(sql`pragma_table_info('daily_budgets')`),
          queryDatabase
            .select({ count: sql<number>`COUNT(*)` })
            .from(sql`sqlite_master`)
            .where(sql`type = 'index' AND name = ${DELIVERY_EXPIRY_INDEX}`),
          queryDatabase
            .insert(dailyBudgets)
            .values({ attempts: 0, utcDate: HEALTH_CHECK_DATE })
            .onConflictDoUpdate({
              set: { attempts: 0 },
              target: dailyBudgets.utcDate,
            }),
          queryDatabase
            .delete(dailyBudgets)
            .where(eq(dailyBudgets.utcDate, HEALTH_CHECK_DATE)),
        ]);
        const deliveryColumns = deliveryInfo.map(({ name }) => name);
        const budgetColumns = budgetInfo.map(({ name }) => name);
        return (
          DELIVERY_COLUMNS.every((name) => deliveryColumns.includes(name)) &&
          BUDGET_COLUMNS.every((name) => budgetColumns.includes(name)) &&
          index[0]?.count === 1
        );
      } catch {
        return false;
      }
    },
    releaseDelivery: (fingerprint) =>
      releaseDelivery(queryDatabase, fingerprint),
    reserveDailyAttempts: (utcDate, requestedAttempts, maximumAttempts) =>
      reserveDailyAttempts(
        queryDatabase,
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
