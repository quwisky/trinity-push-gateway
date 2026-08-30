import path from 'node:path';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      miniflare: {
        bindings: {
          FCM_CLIENT_EMAIL: 'gateway@example.test',
          FCM_PRIVATE_KEY: 'test-private-key',
          FCM_PROJECT_ID: 'test-project',
          FINGERPRINT_KEY: 'test-fingerprint-key-32-bytes-long!',
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
    coverage: {
      provider: 'istanbul',
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
