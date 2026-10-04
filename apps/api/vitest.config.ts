import { defineConfig } from 'vitest/config';

try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file: rely on variables already set in the environment (CI).
}

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database, so test files run one at a time.
    fileParallelism: false,
    // Neon may need a moment to wake a suspended compute on the first query.
    hookTimeout: 30_000,
    testTimeout: 15_000,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
