import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies all pending SQL migrations. Use a direct (non-pooled) connection string on Neon. */
export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb({ connectionString, maxConnections: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
