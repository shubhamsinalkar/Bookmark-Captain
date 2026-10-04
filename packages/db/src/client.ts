import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export interface CreateDbOptions {
  connectionString: string;
  /** Max open connections in the pool. Keep modest when using Neon's pooled endpoint. */
  maxConnections?: number;
  /** Called when an idle pooled connection errors (e.g. Neon suspends compute and drops it). */
  onPoolError?: (error: Error) => void;
}

export function createDb({ connectionString, maxConnections = 10, onPoolError }: CreateDbOptions) {
  const pool = new pg.Pool({
    connectionString,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Without a listener, an error on an idle client crashes the process.
  pool.on('error', (error) => onPoolError?.(error));

  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, pool };
}

export type Database = ReturnType<typeof createDb>['db'];
