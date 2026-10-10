import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { generateKeyPairSync } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// A throwaway key, generated on every config load and never written to disk.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const serviceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'trinity-test',
  client_email: 'gw@trinity-test.iam.gserviceaccount.com',
  private_key: privateKey,
});

// wrangler.jsonc declares the secret as required; setting it here (for this process
// only) keeps the plugin from warning that it is missing.
process.env.FCM_SERVICE_ACCOUNT = serviceAccount;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          FCM_SERVICE_ACCOUNT: serviceAccount,
        },
      },
    }),
  ],
});
