import { runMigrations } from '@bc/db/migrator';
import { TEST_DATABASE_URL } from './harness';

export default async function setup(): Promise<void> {
  await runMigrations(TEST_DATABASE_URL);
}
