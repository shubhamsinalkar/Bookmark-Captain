import { sessions, users } from '@bc/db';
import { SESSION_COOKIE_NAME } from '@bc/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, TEST_WEB_URL } from './harness';

const harness = createTestHarness();
let app: Express;

beforeEach(async () => {
  await harness.reset();
  // A fresh app per test also gives each test fresh rate-limit counters.
  app = harness.createApp();
});
afterAll(() => harness.close());

function getSetCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as string[] | string | undefined;
  return Array.isArray(header) ? header : header ? [header] : [];
}

function findCookie(res: request.Response, name: string): string | undefined {
  return getSetCookies(res).find((cookie) => cookie.startsWith(`${name}=`));
}

function fakeIdToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

describe('GET /auth/providers', () => {
  it('lists enabled sign-in methods', async () => {
    const res = await request(app).get('/auth/providers').expect(200);
    expect(res.body).toEqual({ google: false, password: true, devLogin: true });
  });

  it('is not rate limited: the web server asks for it on every login page view', async () => {
    for (let i = 0; i < 40; i++) await request(app).get('/auth/providers').expect(200);
  });

  it('rate limits the other auth endpoints', async () => {
    for (let i = 0; i < 30; i++) await request(app).post('/auth/logout').expect(204);
    const res = await request(app).post('/auth/logout').expect(429);
    expect(res.body.error.code).toBe('rate_limited');
  });
});

describe('session lifecycle (dev login)', () => {
  it('signs in, reads the current user, and signs out', async () => {
    const agent = request.agent(app);

    const login = await agent
      .post('/auth/dev-login')
      .send({ email: 'Ada@Example.com', name: 'Ada' })
      .expect(200);
    expect(login.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada' });

    const cookie = findCookie(login, SESSION_COOKIE_NAME);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await agent.get('/me').expect(200);
    expect(me.body.user.id).toBe(login.body.user.id);

    await agent.post('/auth/logout').expect(204);
    await agent.get('/me').expect(401);
    expect(await harness.db.select().from(sessions)).toHaveLength(0);
  });

  it('stores only a hash of the session token', async () => {
    const res = await request(app).post('/auth/dev-login').send({ email: 'a@example.com' });
    const token = findCookie(res, SESSION_COOKIE_NAME)!.split(';')[0]!.split('=')[1]!;
    const [row] = await harness.db.select().from(sessions);
    expect(row!.id).not.toBe(token);
    expect(row!.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reuses the same user for the same email', async () => {
    const first = await request(app).post('/auth/dev-login').send({ email: 'same@example.com' });
    const second = await request(app).post('/auth/dev-login').send({ email: 'SAME@example.com' });
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it('replaces the previous session on re-login', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/dev-login').send({ email: 'a@example.com' }).expect(200);
    await agent.post('/auth/dev-login').send({ email: 'a@example.com' }).expect(200);
    expect(await harness.db.select().from(sessions)).toHaveLength(1);
  });

  it('rejects requests without a session', async () => {
    const res = await request(app).get('/me').expect(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('rejects and clears an expired session', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/dev-login').send({ email: 'a@example.com' }).expect(200);
    await harness.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await agent.get('/me').expect(401);
    expect(findCookie(res, SESSION_COOKIE_NAME)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(await harness.db.select().from(sessions)).toHaveLength(0);
  });

  it('extends a session that is past half its lifetime', async () => {
    const agent = request.agent(app);
    await agent.post('/auth/dev-login').send({ email: 'a@example.com' }).expect(200);
    const soon = new Date(Date.now() + 60 * 60 * 1000);
    await harness.db.update(sessions).set({ expiresAt: soon });

    const res = await agent.get('/me').expect(200);
    expect(findCookie(res, SESSION_COOKIE_NAME)).toBeDefined();
    const [row] = await harness.db.select().from(sessions);
    expect(row!.expiresAt.getTime()).toBeGreaterThan(soon.getTime());
  });
});

describe('email and password', () => {
  const ada = { email: 'Ada@Example.com', password: 'correct horse', name: 'Ada' };

  it('signs up, starts a session, and stores only a hash of the password', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/auth/signup').send(ada).expect(201);
    expect(res.body.user).toMatchObject({ email: 'ada@example.com', name: 'Ada' });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(findCookie(res, SESSION_COOKIE_NAME)).toMatch(/HttpOnly/i);

    const me = await agent.get('/me').expect(200);
    expect(me.body.user.id).toBe(res.body.user.id);

    const [row] = await harness.db.select().from(users);
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain('correct horse');
  });

  it('refuses a second account with the same email, whatever its case', async () => {
    await request(app).post('/auth/signup').send(ada).expect(201);
    const res = await request(app)
      .post('/auth/signup')
      .send({ ...ada, email: '  ADA@example.COM ', password: 'another password' })
      .expect(409);
    expect(res.body.error.code).toBe('conflict');
    expect(res.body.error.details).toEqual([
      {
        path: 'email',
        message: expect.stringContaining('An account with this email already exists') as string,
      },
    ]);
    expect(await harness.db.select().from(users)).toHaveLength(1);
  });

  it('refuses to sign up over an email that already signed in another way', async () => {
    await request(app).post('/auth/dev-login').send({ email: 'ada@example.com' }).expect(200);
    await request(app).post('/auth/signup').send(ada).expect(409);
  });

  it('keeps emails unique even when two sign-ups race', async () => {
    const results = await Promise.all([
      request(app).post('/auth/signup').send(ada),
      request(app).post('/auth/signup').send(ada),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await harness.db.select().from(users)).toHaveLength(1);
  });

  it.each([
    ['an invalid email', { email: 'ada@' }, 'email'],
    ['a short password', { password: 'short' }, 'password'],
    ['a password of spaces', { password: '          ' }, 'password'],
    ['a blank name', { name: '  ' }, 'name'],
    ['a missing password', { password: undefined }, 'password'],
  ])('rejects sign-up with %s', async (_label, override, path) => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ ...ada, ...override })
      .expect(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual([{ path, message: expect.any(String) }]);
    expect(await harness.db.select().from(users)).toHaveLength(0);
  });

  it('signs in with the right password, ignoring the case of the email', async () => {
    await request(app).post('/auth/signup').send(ada).expect(201);

    const agent = request.agent(app);
    const res = await agent
      .post('/auth/login')
      .send({ email: 'ADA@example.com', password: 'correct horse' })
      .expect(200);
    expect(res.body.user.email).toBe('ada@example.com');
    await agent.get('/me').expect(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await request(app).post('/auth/signup').send(ada).expect(201);
    // An account that exists but has no password (it signed in another way).
    await request(app).post('/auth/dev-login').send({ email: 'grace@example.com' }).expect(200);

    for (const attempt of [
      { email: 'ada@example.com', password: 'wrong horse' },
      { email: 'nobody@example.com', password: 'correct horse' },
      { email: 'grace@example.com', password: 'correct horse' },
    ]) {
      const res = await request(app).post('/auth/login').send(attempt).expect(401);
      expect(res.body.error).toEqual({
        code: 'unauthorized',
        message: 'Incorrect email or password',
      });
      expect(findCookie(res, SESSION_COOKIE_NAME)).toBeUndefined();
    }
  });

  it('validates the sign-in body', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: '' })
      .expect(400);
    expect(res.body.error.details).toEqual([{ path: 'password', message: 'Enter your password' }]);
  });

  it('slows down password guessing', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app).post('/auth/login').send({ email: 'a@example.com', password: 'guess' });
    }
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'a@example.com', password: 'guess' })
      .expect(429);
    expect(res.body.error.code).toBe('rate_limited');
  });

  it('never counts successful sign-ins toward that limit', async () => {
    await request(app).post('/auth/signup').send(ada).expect(201);
    for (let i = 0; i < 21; i++) {
      await request(app)
        .post('/auth/login')
        .send({ email: ada.email, password: ada.password })
        .expect(200);
    }
  });

  it('blocks cross-origin sign-up', async () => {
    await request(app)
      .post('/auth/signup')
      .set('origin', 'https://evil.example')
      .send(ada)
      .expect(403);
  });
});

describe('POST /auth/dev-login', () => {
  it('validates the body', async () => {
    const res = await request(app).post('/auth/dev-login').send({ email: 'nope' }).expect(400);
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.details).toEqual([{ path: 'email', message: expect.any(String) }]);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/auth/dev-login')
      .set('content-type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(res.body.error.code).toBe('bad_request');
  });

  it('does not exist when dev login is disabled', async () => {
    const prodLike = harness.createApp({ AUTH_DEV_LOGIN: 'false' });
    await request(prodLike).post('/auth/dev-login').send({ email: 'a@example.com' }).expect(404);
  });

  it('blocks cross-origin requests', async () => {
    const res = await request(app)
      .post('/auth/dev-login')
      .set('origin', 'https://evil.example')
      .send({ email: 'a@example.com' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it('allows requests from the web app origin', async () => {
    await request(app)
      .post('/auth/dev-login')
      .set('origin', TEST_WEB_URL)
      .send({ email: 'a@example.com' })
      .expect(200);
  });
});

describe('Google sign-in', () => {
  let googleApp: Express;

  beforeEach(() => {
    googleApp = harness.createApp({
      GOOGLE_CLIENT_ID: 'client-123',
      GOOGLE_CLIENT_SECRET: 'secret-456',
    });
  });

  async function startGoogleFlow(agent: ReturnType<typeof request.agent>) {
    const res = await agent.get('/auth/google').expect(302);
    const location = new URL(res.headers.location!);
    return { location, state: location.searchParams.get('state')! };
  }

  function mockGoogleTokenEndpoint(claims: Record<string, unknown>) {
    const fetchMock = vi.fn((_url: string | URL, _init?: RequestInit) =>
      Response.json({
        id_token: fakeIdToken({
          iss: 'https://accounts.google.com',
          aud: 'client-123',
          exp: Math.floor(Date.now() / 1000) + 3600,
          sub: 'google-sub-1',
          email: 'grace@example.com',
          email_verified: true,
          name: 'Grace Hopper',
          ...claims,
        }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('redirects to Google with PKCE and a state cookie', async () => {
    const agent = request.agent(googleApp);
    const res = await agent.get('/auth/google').expect(302);
    const location = new URL(res.headers.location!);

    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('client-123');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4000/auth/google/callback',
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(findCookie(res, 'bc_oauth')).toMatch(/HttpOnly/i);
  });

  it('signs the user in after a successful callback', async () => {
    const agent = request.agent(googleApp);
    const { state } = await startGoogleFlow(agent);
    const fetchMock = mockGoogleTokenEndpoint({});

    const res = await agent.get('/auth/google/callback').query({ code: 'abc', state }).expect(302);
    expect(res.headers.location).toBe(`${TEST_WEB_URL}/inbox`);
    expect(fetchMock).toHaveBeenCalledOnce();

    const me = await agent.get('/me').expect(200);
    expect(me.body.user).toMatchObject({ email: 'grace@example.com', name: 'Grace Hopper' });
  });

  it('links to an existing account with the same email', async () => {
    const existing = await request(googleApp)
      .post('/auth/dev-login')
      .send({ email: 'grace@example.com' });

    const agent = request.agent(googleApp);
    const { state } = await startGoogleFlow(agent);
    mockGoogleTokenEndpoint({});
    await agent.get('/auth/google/callback').query({ code: 'abc', state }).expect(302);

    const me = await agent.get('/me').expect(200);
    expect(me.body.user.id).toBe(existing.body.user.id);
    expect(await harness.db.select().from(users)).toHaveLength(1);
  });

  it('removes an unverified password once Google proves who owns the email', async () => {
    // Someone signs up with Grace's address before Grace ever uses the app.
    const squatter = request.agent(googleApp);
    await squatter
      .post('/auth/signup')
      .send({ email: 'grace@example.com', password: 'squatter password' })
      .expect(201);

    const grace = request.agent(googleApp);
    const { state } = await startGoogleFlow(grace);
    mockGoogleTokenEndpoint({});
    await grace.get('/auth/google/callback').query({ code: 'abc', state }).expect(302);

    await grace.get('/me').expect(200);
    await squatter.get('/me').expect(401);
    await request(googleApp)
      .post('/auth/login')
      .send({ email: 'grace@example.com', password: 'squatter password' })
      .expect(401);
    const [row] = await harness.db.select().from(users);
    expect(row!.passwordHash).toBeNull();
  });

  it('keeps the password of an account already linked to Google', async () => {
    const agent = request.agent(googleApp);
    const { state } = await startGoogleFlow(agent);
    mockGoogleTokenEndpoint({});
    await agent.get('/auth/google/callback').query({ code: 'abc', state }).expect(302);
    await harness.db.update(users).set({ passwordHash: 'scrypt$kept' });

    const again = await startGoogleFlow(agent);
    mockGoogleTokenEndpoint({});
    await agent.get('/auth/google/callback').query({ code: 'abc', state: again.state }).expect(302);
    const [row] = await harness.db.select().from(users);
    expect(row!.passwordHash).toBe('scrypt$kept');
  });

  it('rejects a callback whose state does not match', async () => {
    const agent = request.agent(googleApp);
    await startGoogleFlow(agent);
    const fetchMock = mockGoogleTokenEndpoint({});

    const res = await agent
      .get('/auth/google/callback')
      .query({ code: 'abc', state: 'forged' })
      .expect(302);
    expect(res.headers.location).toBe(`${TEST_WEB_URL}/login?error=invalid_state`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an ID token issued to another client', async () => {
    const agent = request.agent(googleApp);
    const { state } = await startGoogleFlow(agent);
    mockGoogleTokenEndpoint({ aud: 'someone-else' });

    const res = await agent.get('/auth/google/callback').query({ code: 'abc', state }).expect(302);
    expect(res.headers.location).toBe(`${TEST_WEB_URL}/login?error=google_failed`);
    await agent.get('/me').expect(401);
  });

  it('handles the user cancelling on the consent screen', async () => {
    const res = await request(googleApp)
      .get('/auth/google/callback')
      .query({ error: 'access_denied' })
      .expect(302);
    expect(res.headers.location).toBe(`${TEST_WEB_URL}/login?error=google_cancelled`);
  });

  it('reports Google as unavailable when not configured', async () => {
    const res = await request(app).get('/auth/google').expect(503);
    expect(res.body.error.code).toBe('service_unavailable');
  });
});
