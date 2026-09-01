import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL: 'gateway@example.test',
          TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: 'test-private-key',
          TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID: 'test-project',
          TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY:
            'test-fingerprint-key-32-bytes-long!',
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, 'migrations'),
          ),
        },
      },
      wrangler: {
        configPath: './wrangler.jsonc',
      },
    })),
  ],
  test: {
    include: ['test/*.spec.ts'],
    coverage: {
      exclude: [
        'src/configuration-catalog/administration.ts',
        'src/configuration-catalog/bun.ts',
      ],
      provider: 'istanbul',
      reportsDirectory: '../../coverage/apps/push-gateway',
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
