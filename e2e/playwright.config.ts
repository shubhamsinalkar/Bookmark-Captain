import { defineConfig } from '@playwright/test';
import { E2E } from './env';

const apiPort = new URL(E2E.apiUrl).port;
const webPort = new URL(E2E.webUrl).port;

export default defineConfig({
  testDir: './tests',
  // One shared database: run tests one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: E2E.webUrl,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @bc/api exec tsx src/server.ts',
      url: `${E2E.apiUrl}/healthz`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        PORT: apiPort,
        DATABASE_URL: E2E.databaseUrl,
        API_URL: E2E.apiUrl,
        WEB_URL: E2E.webUrl,
        AUTH_DEV_LOGIN: 'true',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
      },
    },
    {
      // A production build of the web app, in its own output folder.
      command: `pnpm --filter @bc/web build && pnpm --filter @bc/web exec next start --port ${webPort}`,
      url: `${E2E.webUrl}/login`,
      timeout: 300_000,
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_API_URL: E2E.apiUrl,
        NEXT_DIST_DIR: '.next-e2e',
      },
    },
  ],
});
