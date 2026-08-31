import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { cloudflareRuntime } from '../src/cloudflare-runtime';
import {
  exerciseStoreContract,
  exerciseUnavailableStoreContract,
} from './support/store-contract';

describe('D1 gateway store contract', () => {
  beforeEach(async () => {
    await env.TRINITY_PUSH_GATEWAY_DB.batch([
      env.TRINITY_PUSH_GATEWAY_DB.prepare('DELETE FROM delivery_records'),
      env.TRINITY_PUSH_GATEWAY_DB.prepare('DELETE FROM daily_budgets'),
    ]);
  });

  it('preserves budget and delivery coordination semantics', async () => {
    await expect(
      exerciseStoreContract(cloudflareRuntime(env).store),
    ).resolves.toEqual({
      budget: [true, false, true],
      claims: ['acquired', 'pending', 'acquired', 'rejected', 'acquired'],
      cleanupReleasesExpiredBudget: true,
      concurrentBudgetReservations: 1,
      concurrentClaims: ['acquired', 'pending', 'pending', 'pending'],
      deliveredClaimSurvivesRelease: 'delivered',
      pendingLeaseRecovery: ['acquired', 'pending', 'acquired'],
      zeroAndOversizedBudget: [true, false],
    });
  });

  it('fails closed when its adapter cannot write', async () => {
    const store = cloudflareRuntime(env).store;
    await exerciseUnavailableStoreContract(store, async (operation) => {
      await env.TRINITY_PUSH_GATEWAY_DB.exec(
        'ALTER TABLE daily_budgets RENAME TO unavailable_daily_budgets',
      );
      try {
        return await operation();
      } finally {
        await env.TRINITY_PUSH_GATEWAY_DB.exec(
          'ALTER TABLE unavailable_daily_budgets RENAME TO daily_budgets',
        );
      }
    });
  });

  it('reports an incomplete schema as unready', async () => {
    await env.TRINITY_PUSH_GATEWAY_DB.exec(
      'DROP INDEX delivery_records_expiry_idx',
    );
    try {
      await expect(cloudflareRuntime(env).store.ready()).resolves.toBe(false);
    } finally {
      await env.TRINITY_PUSH_GATEWAY_DB.exec(
        'CREATE INDEX delivery_records_expiry_idx ON delivery_records (expires_at)',
      );
    }
  });

  it('keeps cleanup and readiness inside explicit D1 batches', async () => {
    const batchSizes: number[] = [];
    const database = new Proxy(env.TRINITY_PUSH_GATEWAY_DB, {
      get(target, property) {
        if (property === 'batch') {
          return async (...parameters: Parameters<D1Database['batch']>) => {
            batchSizes.push(parameters[0].length);
            return target.batch(...parameters);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function'
          ? (value.bind(target) as unknown)
          : value;
      },
    });
    const store = cloudflareRuntime({
      ...env,
      TRINITY_PUSH_GATEWAY_DB: database,
    }).store;

    await store.cleanup(0, '2033-05-17');
    await expect(store.ready()).resolves.toBe(true);

    expect(batchSizes).toEqual([2, 5]);
  });

  it('keeps migration ownership outside the runtime adapter', async () => {
    const metadata = await env.TRINITY_PUSH_GATEWAY_DB.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    ).first<{ readonly count: number }>();

    expect(metadata?.count).toBe(0);
  });
});
