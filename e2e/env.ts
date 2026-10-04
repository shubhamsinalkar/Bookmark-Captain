import path from 'node:path';

try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../.env'));
} catch {
  // No .env: CI provides the variables directly.
}

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set: the end-to-end suite wipes it.');
  if (url === process.env.DATABASE_URL || url === process.env.DATABASE_URL_UNPOOLED) {
    throw new Error('TEST_DATABASE_URL must not be the app database: the suite deletes all rows.');
  }
  return url;
}

/**
 * The suite runs its own API and web servers on separate ports against the test database,
 * so it never touches development data or collides with `pnpm dev`.
 */
export const E2E = {
  apiUrl: 'http://localhost:4100',
  webUrl: 'http://localhost:3100',
  databaseUrl: requireTestDatabaseUrl(),
  extensionDir: path.resolve(import.meta.dirname, '.extension'),
  /** A made-up site served by Playwright, for teaching the extension a site it has never seen. */
  fakeSiteUrl: 'https://savedstuff.test',
};
