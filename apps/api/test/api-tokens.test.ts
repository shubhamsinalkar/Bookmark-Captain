import { apiTokens } from '@bc/db';
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

describe('API tokens', () => {
  it('returns the token once and stores only its hash', async () => {
    const { agent, token } = await createApiToken(app);
    expect(token).toMatch(/^bct_[A-Za-z0-9_-]{43}$/);

    const [row] = await harness.db.select().from(apiTokens);
    expect(row!.tokenHash).not.toContain(token);
    expect(token.startsWith(row!.preview)).toBe(true);

    const list = await agent.get('/api-tokens').expect(200);
    expect(list.body.items).toEqual([
      expect.objectContaining({ name: 'Test extension', preview: row!.preview, lastUsedAt: null }),
    ]);
    expect(JSON.stringify(list.body)).not.toContain(token);
  });

  it('authenticates bearer requests and records last use', async () => {
    const { token, userId } = await createApiToken(app);
    const me = await request(app).get('/me').auth(token, { type: 'bearer' }).expect(200);
    expect(me.body.user.id).toBe(userId);

    const [row] = await harness.db.select().from(apiTokens);
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it('accepts bearer requests from the extension origin', async () => {
    const { token } = await createApiToken(app);
    await request(app)
      .post('/bookmarks/ingest')
      .set('origin', 'chrome-extension://abcdefghijklmnop')
      .auth(token, { type: 'bearer' })
      .send({ items: [{ platform: 'browser', url: 'https://example.com' }] })
      .expect(200);
  });

  it('rejects unknown, malformed and revoked tokens', async () => {
    const { agent, token, tokenId } = await createApiToken(app);
    await request(app).get('/me').auth('bct_nope', { type: 'bearer' }).expect(401);
    await request(app).get('/me').auth('not-a-token', { type: 'bearer' }).expect(401);

    await agent.delete(`/api-tokens/${tokenId}`).expect(204);
    await request(app).get('/me').auth(token, { type: 'bearer' }).expect(401);
  });

  it('lets a token revoke itself, but only with the token', async () => {
    const { agent, token } = await createApiToken(app);
    const { token: otherToken } = await createApiToken(app);
    // A browser session has no "current" token.
    await agent.delete('/api-tokens/current').expect(401);

    await request(app).delete('/api-tokens/current').auth(token, { type: 'bearer' }).expect(204);
    await request(app).get('/me').auth(token, { type: 'bearer' }).expect(401);
    // Other tokens of the same user are unaffected.
    await request(app).get('/me').auth(otherToken, { type: 'bearer' }).expect(200);
  });

  it('rejects expired tokens', async () => {
    const { token } = await createApiToken(app);
    await harness.db.update(apiTokens).set({ expiresAt: new Date(Date.now() - 1000) });
    await request(app).get('/me').auth(token, { type: 'bearer' }).expect(401);
  });

  it('cannot be used to manage tokens', async () => {
    const { token } = await createApiToken(app);
    const res = await request(app)
      .post('/api-tokens')
      .auth(token, { type: 'bearer' })
      .send({ name: 'escalation' })
      .expect(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it("cannot revoke another user's token", async () => {
    const { tokenId } = await createApiToken(app, 'owner@example.com');
    const { agent: other } = await signIn(app, 'other@example.com');
    await other.delete(`/api-tokens/${tokenId}`).expect(404);
    await other.delete('/api-tokens/not-a-uuid').expect(404);
  });

  it('validates the token name', async () => {
    const { agent } = await signIn(app);
    await agent.post('/api-tokens').send({ name: '  ' }).expect(400);
  });
});
