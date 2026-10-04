import { createDb } from '@bc/db';
import { sql } from 'drizzle-orm';
import type { Express } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createContext } from '../src/context';

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a disposable database (e.g. a Neon "test" branch): ' +
        'the test suite deletes all rows.',
    );
  }
  if (url === process.env.DATABASE_URL || url === process.env.DATABASE_URL_UNPOOLED) {
    throw new Error(
      'TEST_DATABASE_URL must not be the app database: the test suite deletes all rows.',
    );
  }
  return url;
}

export const TEST_DATABASE_URL = requireTestDatabaseUrl();

export const TEST_WEB_URL = 'http://localhost:3000';
export const TEST_API_URL = 'http://localhost:4000';

/** An Express app or a listening server. */
type TestTarget = Parameters<typeof request.agent>[0];

/** A supertest agent holding a session cookie for a (new or existing) user. */
export async function signIn(app: TestTarget, email = 'ada@example.com') {
  const agent = request.agent(app);
  const res = await agent.post('/auth/dev-login').send({ email }).expect(200);
  return { agent, userId: res.body.user.id as string };
}

/** Mints an API token through the session-authenticated endpoint. */
export async function createApiToken(app: TestTarget, email = 'ada@example.com') {
  const { agent, userId } = await signIn(app, email);
  const res = await agent.post('/api-tokens').send({ name: 'Test extension' }).expect(201);
  return {
    agent,
    userId,
    token: res.body.token as string,
    tokenId: res.body.apiToken.id as string,
  };
}

export function createTestEnv(overrides: Record<string, string> = {}) {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    API_URL: TEST_API_URL,
    WEB_URL: TEST_WEB_URL,
    AUTH_DEV_LOGIN: 'true',
    ...overrides,
  });
}

/** One pool per test file; `reset` wipes all rows so each test starts clean. */
export function createTestHarness() {
  const { db, pool } = createDb({ connectionString: TEST_DATABASE_URL, maxConnections: 2 });

  return {
    db,
    /** Builds a fresh app (and fresh rate-limit counters). Also returns its context. */
    createAppWithContext(envOverrides: Record<string, string> = {}) {
      const env = createTestEnv(envOverrides);
      const ctx = createContext({ env, logger: pino({ level: 'silent' }), db });
      return { app: createApp(ctx), ctx };
    },
    createApp(envOverrides: Record<string, string> = {}): Express {
      return this.createAppWithContext(envOverrides).app;
    },
    async reset() {
      // Every user-owned table cascades from users.
      await db.execute(sql`truncate table users restart identity cascade`);
    },
    async close() {
      await pool.end();
    },
  };
}
