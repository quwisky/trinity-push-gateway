import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from 'cloudflare:test';
import { beforeAll } from 'vitest';

import type { Env as GatewayEnv } from '../src/cloudflare-env';

declare global {
  namespace Cloudflare {
    interface Env extends GatewayEnv {
      readonly TEST_MIGRATIONS: D1Migration[];
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.TRINITY_PUSH_GATEWAY_DB, env.TEST_MIGRATIONS);
});
