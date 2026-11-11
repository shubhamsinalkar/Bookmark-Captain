import { sessions } from '@bc/db';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiToken, createTestHarness, signIn } from './harness';

const harness = createTestHarness();
let app: Express;

beforeEach(async () => {
  await harness.reset();
  app = harness.createApp();
});
afterAll(() => harness.close());

const login = (email: string, password: string) =>
  request(app).post('/auth/login').send({ email, password });

describe('PUT /me/password', () => {
  it('lets an account without a password (e.g. made with Google) add one', async () => {
    const { agent } = await signIn(app, 'grace@example.com');
    expect((await agent.get('/me').expect(200)).body.user.hasPassword).toBe(false);

    const res = await agent
      .put('/me/password')
      .send({ newPassword: 'a brand new password' })
      .expect(200);
    expect(res.body.user).toMatchObject({ email: 'grace@example.com', hasPassword: true });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    await login('grace@example.com', 'a brand new password').expect(200);
    // Still signed in where the password was set.
    await agent.get('/me').expect(200);
  });

  it('asks for the current password before changing an existing one', async () => {
    const agent = request.agent(app);
    await agent
      .post('/auth/signup')
      .send({ email: 'ada@example.com', password: 'old password' })
      .expect(201);

    const missing = await agent
      .put('/me/password')
      .send({ newPassword: 'new password' })
      .expect(400);
    expect(missing.body.error.details).toEqual([
      { path: 'currentPassword', message: 'Enter your current password' },
    ]);

    const wrong = await agent
      .put('/me/password')
      .send({ currentPassword: 'not it', newPassword: 'new password' })
      .expect(403);
    expect(wrong.body.error.details).toEqual([
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
    // A wrong password doesn't end the session, and nothing changed.
    await agent.get('/me').expect(200);
    await login('ada@example.com', 'old password').expect(200);
  });

  it('changes the password and signs out every other session', async () => {
    const here = request.agent(app);
    await here
      .post('/auth/signup')
      .send({ email: 'ada@example.com', password: 'old password' })
      .expect(201);
    const elsewhere = request.agent(app);
    await elsewhere
      .post('/auth/login')
      .send({ email: 'ada@example.com', password: 'old password' })
      .expect(200);
    expect(await harness.db.select().from(sessions)).toHaveLength(2);

    await here
      .put('/me/password')
      .send({ currentPassword: 'old password', newPassword: 'new password' })
      .expect(200);

    await here.get('/me').expect(200);
    await elsewhere.get('/me').expect(401);
    await login('ada@example.com', 'old password').expect(401);
    await login('ada@example.com', 'new password').expect(200);
  });

  it('applies the same rules as sign-up to the new password', async () => {
    const { agent } = await signIn(app);
    const res = await agent.put('/me/password').send({ newPassword: 'short' }).expect(400);
    expect(res.body.error.details).toEqual([
      { path: 'newPassword', message: 'Use at least 8 characters' },
    ]);
  });

  it('requires a signed-in browser session', async () => {
    await request(app).put('/me/password').send({ newPassword: 'new password' }).expect(401);

    const { token } = await createApiToken(app);
    await request(app)
      .put('/me/password')
      .set('authorization', `Bearer ${token}`)
      .send({ newPassword: 'new password' })
      .expect(403);
  });

  it('blocks cross-origin requests', async () => {
    const { agent } = await signIn(app);
    await agent
      .put('/me/password')
      .set('origin', 'https://evil.example')
      .send({ newPassword: 'new password' })
      .expect(403);
  });

  it('slows down guessing the current password', async () => {
    const agent = request.agent(app);
    await agent
      .post('/auth/signup')
      .send({ email: 'ada@example.com', password: 'old password' })
      .expect(201);
    const guess = () =>
      agent.put('/me/password').send({ currentPassword: 'guess', newPassword: 'new password' });

    for (let i = 0; i < 10; i++) await guess().expect(403);
    const res = await guess().expect(429);
    expect(res.body.error.code).toBe('rate_limited');
  });
});
