import { defineConfig } from 'drizzle-kit';

try {
  process.loadEnvFile('../../.env');
} catch {
  // No .env file: rely on variables already set in the environment (CI, production).
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    // Migrations and introspection need a direct (non-pooled) connection on Neon.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
});
