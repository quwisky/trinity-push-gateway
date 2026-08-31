import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(projectRoot, '../..');

export default defineConfig({
  testDir: path.join(projectRoot, 'e2e'),
  outputDir: path.join(
    workspaceRoot,
    'test-output/test-results/push-gateway-ui',
  ),
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  reporter: [['line']],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@mobile/u,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      grep: /@cross-browser/u,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@cross-browser/u,
    },
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 13'] },
      grep: /@mobile/u,
    },
  ],
});
