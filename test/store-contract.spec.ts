import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { cloudflareRuntime } from '../src/cloudflare-runtime';
import { exerciseStoreContract } from './support/store-contract';

describe('D1 gateway store contract', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM delivery_records'),
      env.DB.prepare('DELETE FROM daily_budgets'),
    ]);
  });

  it('preserves budget and delivery coordination semantics', async () => {
    await expect(
      exerciseStoreContract(cloudflareRuntime(env).store),
    ).resolves.toEqual({
      budget: [true, false, true],
      claims: ['acquired', 'pending', 'acquired', 'rejected', 'acquired'],
    });
  });
});
