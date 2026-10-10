import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { generateKeyPairSync } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// A throwaway key, generated on every config load and never written to disk.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          FCM_SERVICE_ACCOUNT: JSON.stringify({
            type: 'service_account',
            project_id: 'trinity-test',
            client_email: 'gw@trinity-test.iam.gserviceaccount.com',
            private_key: privateKey,
          }),
        },
      },
    }),
  ],
});
