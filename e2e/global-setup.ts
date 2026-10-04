import { execSync } from 'node:child_process';
import { createDb } from '@bc/db';
import { runMigrations } from '@bc/db/migrator';
import { sql } from 'drizzle-orm';
import { E2E } from './env';

export default async function globalSetup(): Promise<void> {
  await runMigrations(E2E.databaseUrl);

  const { db, pool } = createDb({ connectionString: E2E.databaseUrl, maxConnections: 1 });
  try {
    await db.execute(sql`truncate table users restart identity cascade`);
  } finally {
    await pool.end();
  }

  // An extension build that talks to the suite's servers instead of the dev ones.
  execSync('pnpm --filter @bc/extension build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      EXTENSION_OUT_DIR: E2E.extensionDir,
      EXTENSION_API_URL: E2E.apiUrl,
      EXTENSION_WEB_URL: E2E.webUrl,
      // Playwright can't click Chrome's permission prompt, so the test site is granted up front.
      EXTENSION_GRANT_HOSTS: E2E.fakeSiteUrl,
    },
  });
}
