import { runMigrations } from './migrator';

const connectionString = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL (or DATABASE_URL_UNPOOLED) must be set to run migrations.');
  process.exit(1);
}

try {
  await runMigrations(connectionString);
  console.log('Migrations applied.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exitCode = 1;
}
