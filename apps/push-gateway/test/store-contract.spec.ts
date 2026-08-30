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
      concurrentBudgetReservations: 1,
      concurrentClaims: ['acquired', 'pending', 'pending', 'pending'],
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
});
