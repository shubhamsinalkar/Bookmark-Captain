import { bookmarks } from '@bc/db';
import type { Bookmark, IngestItem } from '@bc/shared';
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

type Agent = Awaited<ReturnType<typeof signIn>>['agent'];

async function ingest(agent: Agent, items: IngestItem[]) {
  return (await agent.post('/bookmarks/ingest').send({ items }).expect(200)).body as {
    created: number;
    updated: number;
    rejected: { index: number; reason: string }[];
  };
}

async function list(agent: Agent, query: Record<string, string | number> = {}) {
  return (await agent.get('/bookmarks').query(query).expect(200)).body as {
    items: Bookmark[];
    nextCursor: string | null;
  };
}

const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();

describe('POST /bookmarks/ingest', () => {
  it('creates bookmarks and reports invalid URLs per item', async () => {
    const { agent } = await signIn(app);
    const result = await ingest(agent, [
      { platform: 'browser', url: 'https://example.com/a?utm_source=news', title: 'A' },
      { platform: 'browser', url: 'javascript:alert(1)' },
      { platform: 'x', externalId: '123', url: 'https://twitter.com/u/status/123', author: 'u' },
    ]);
    expect(result).toEqual({
      created: 2,
      updated: 0,
      rejected: [{ index: 1, reason: expect.stringContaining('scheme') }],
    });

    const { items } = await list(agent);
    const browserItem = items.find((item) => item.platform === 'browser')!;
    expect(browserItem).toMatchObject({
      url: 'https://example.com/a',
      canonicalUrl: 'https://example.com/a',
      externalId: 'https://example.com/a',
      status: 'unread',
      title: 'A',
    });
    expect(items.find((item) => item.platform === 'x')).toMatchObject({
      externalId: '123',
      canonicalUrl: 'https://x.com/u/status/123',
    });
  });

  it('saves the rest of a batch when one item fails validation', async () => {
    const { agent } = await signIn(app);
    const result = await ingest(agent, [
      { platform: 'browser', url: 'https://example.com/a' },
      { platform: 'browser', url: `https://example.com/?q=${'x'.repeat(5000)}` },
      { platform: 'browser', url: 'javascript:void(0)' },
      { platform: 'browser', url: 'https://example.com/b', title: 'B' },
    ]);
    expect(result).toEqual({
      created: 2,
      updated: 0,
      rejected: [
        { index: 1, reason: expect.stringContaining('url:') },
        { index: 2, reason: expect.stringContaining('scheme') },
      ],
    });
    expect((await list(agent)).items).toHaveLength(2);
  });

  it('accepts any site as a platform, by its domain, and lists sources', async () => {
    const { agent } = await signIn(app);
    const result = await ingest(agent, [
      { platform: 'pinterest.com', externalId: '42', url: 'https://www.pinterest.com/pin/42/' },
      { platform: 'pinterest.com', externalId: '43', url: 'https://www.pinterest.com/pin/43/' },
      { platform: 'x', externalId: '1', url: 'https://x.com/a/status/1' },
      { platform: 'not a site', url: 'https://example.com/' },
    ]);
    expect(result.created).toBe(3);
    expect(result.rejected).toEqual([{ index: 3, reason: expect.stringContaining('platform') }]);

    const { body } = await agent.get('/bookmarks/sources').expect(200);
    expect(body).toEqual({
      sources: [
        { platform: 'pinterest.com', count: 2 },
        { platform: 'x', count: 1 },
      ],
    });
    expect((await list(agent, { platform: 'pinterest.com' })).items).toHaveLength(2);
  });

  it('is idempotent and skips unchanged rows', async () => {
    const { agent } = await signIn(app);
    const items: IngestItem[] = [{ platform: 'browser', url: 'https://example.com/a', title: 'A' }];
    await ingest(agent, items);
    const [before] = await harness.db.select().from(bookmarks);

    expect(await ingest(agent, items)).toEqual({ created: 0, updated: 0, rejected: [] });
    const [after] = await harness.db.select().from(bookmarks);
    expect(after!.updatedAt).toEqual(before!.updatedAt);
  });

  it('updates content but keeps status and savedAt', async () => {
    const { agent } = await signIn(app);
    await ingest(agent, [
      { platform: 'browser', url: 'https://example.com/a', title: 'Old', savedAt: day(1) },
    ]);
    const [{ id }] = (await list(agent)).items as [Bookmark];
    await agent.patch(`/bookmarks/${id}`).send({ status: 'done' }).expect(200);

    const result = await ingest(agent, [
      { platform: 'browser', url: 'https://example.com/a', title: 'New', savedAt: day(9) },
    ]);
    expect(result).toMatchObject({ created: 0, updated: 1 });

    const [row] = await harness.db.select().from(bookmarks);
    expect(row).toMatchObject({ title: 'New', status: 'done' });
    expect(row!.savedAt.toISOString()).toBe(day(1));
  });

  it('keeps the existing title when an update omits it', async () => {
    const { agent } = await signIn(app);
    await ingest(agent, [{ platform: 'browser', url: 'https://example.com/a', title: 'Keep me' }]);
    await ingest(agent, [
      { platform: 'browser', url: 'https://example.com/a', metadata: { folder: 'Reading' } },
    ]);
    const [row] = await harness.db.select().from(bookmarks);
    expect(row).toMatchObject({ title: 'Keep me', metadata: { folder: 'Reading' } });
  });

  it('collapses URL variants of the same page into one browser bookmark', async () => {
    const { agent } = await signIn(app);
    const result = await ingest(agent, [
      { platform: 'browser', url: 'http://www.example.com/post/?utm_campaign=x' },
      { platform: 'browser', url: 'https://example.com/post#comments' },
    ]);
    expect(result.created).toBe(1);
    expect(await harness.db.$count(bookmarks)).toBe(1);
  });

  it('validates the batch envelope, and items individually', async () => {
    const { agent } = await signIn(app);
    await agent.post('/bookmarks/ingest').send({ items: [] }).expect(400);
    await agent.post('/bookmarks/ingest').send({ nope: true }).expect(400);
    expect(await ingest(agent, [{ platform: 'myspace', url: 'https://example.com' }])).toEqual({
      created: 0,
      updated: 0,
      rejected: [{ index: 0, reason: expect.stringContaining('platform') }],
    });
    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      platform: 'browser',
      url: `https://example.com/${i}`,
    }));
    await agent.post('/bookmarks/ingest').send({ items: tooMany }).expect(400);
  });

  it('requires authentication', async () => {
    await request(app)
      .post('/bookmarks/ingest')
      .send({ items: [{ platform: 'browser', url: 'https://example.com' }] })
      .expect(401);
  });

  it('works with an API token', async () => {
    const { token } = await createApiToken(app);
    const res = await request(app)
      .post('/bookmarks/ingest')
      .auth(token, { type: 'bearer' })
      .send({ items: [{ platform: 'browser', url: 'https://example.com' }] })
      .expect(200);
    expect(res.body.created).toBe(1);
  });
});

describe('GET /bookmarks', () => {
  async function seed(agent: Agent) {
    await ingest(agent, [
      {
        platform: 'browser',
        url: 'https://a.example.com',
        title: 'Rust ownership',
        savedAt: day(5),
      },
      { platform: 'browser', url: 'https://b.example.com', title: 'Go channels', savedAt: day(4) },
      {
        platform: 'x',
        externalId: '1',
        url: 'https://x.com/a/status/1',
        title: '100% Rust',
        savedAt: day(3),
      },
      {
        platform: 'x',
        externalId: '2',
        url: 'https://x.com/a/status/2',
        title: 'Postgres tips',
        savedAt: day(2),
      },
      {
        platform: 'reddit',
        externalId: 't3_1',
        url: 'https://reddit.com/r/rust/1',
        title: 'Rust jobs',
        savedAt: day(1),
      },
    ]);
    return (await list(agent, { view: 'all' })).items;
  }

  it('lists newest first and paginates with a cursor', async () => {
    const { agent } = await signIn(app);
    await seed(agent);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(agent, { limit: 2, ...(cursor && { cursor }) });
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.savedAt));
      cursor = page.nextCursor;
    } while (cursor);

    expect(seen).toEqual([day(5), day(4), day(3), day(2), day(1)]);
  });

  it('filters by view', async () => {
    const { agent } = await signIn(app);
    const [first, second, third] = (await seed(agent)) as [Bookmark, Bookmark, Bookmark];
    await agent.patch(`/bookmarks/${first.id}`).send({ status: 'done' }).expect(200);
    await agent.patch(`/bookmarks/${second.id}`).send({ status: 'archived' }).expect(200);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await agent.patch(`/bookmarks/${third.id}`).send({ snoozeUntil: tomorrow }).expect(200);

    const titles = async (view: string) =>
      (await list(agent, { view })).items.map((item) => item.title);
    expect(await titles('inbox')).toEqual(['Postgres tips', 'Rust jobs']);
    expect(await titles('done')).toEqual(['Rust ownership']);
    expect(await titles('archived')).toEqual(['Go channels']);
    expect(await titles('snoozed')).toEqual(['100% Rust']);
    expect(await titles('all')).toHaveLength(5);
  });

  it('counts each view with the same rules', async () => {
    const { agent } = await signIn(app);
    const [first, second, third, fourth] = (await seed(agent)) as [
      Bookmark,
      Bookmark,
      Bookmark,
      Bookmark,
    ];
    await agent.patch(`/bookmarks/${first.id}`).send({ status: 'done' }).expect(200);
    await agent.patch(`/bookmarks/${second.id}`).send({ status: 'archived' }).expect(200);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await agent.patch(`/bookmarks/${third.id}`).send({ snoozeUntil: tomorrow }).expect(200);
    await agent.patch(`/bookmarks/${fourth.id}`).send({ status: 'opened' }).expect(200);

    const { body } = await agent.get('/bookmarks/counts').expect(200);
    expect(body).toEqual({ inbox: 2, unread: 1, snoozed: 1, done: 1, archived: 1, all: 5 });

    const { agent: other } = await signIn(app, 'other@example.com');
    expect((await other.get('/bookmarks/counts').expect(200)).body).toEqual({
      inbox: 0,
      unread: 0,
      snoozed: 0,
      done: 0,
      archived: 0,
      all: 0,
    });
  });

  it('filters by platform and search text', async () => {
    const { agent } = await signIn(app);
    await seed(agent);
    const titles = async (query: Record<string, string>) =>
      (await list(agent, query)).items.map((item) => item.title);

    expect(await titles({ platform: 'x' })).toEqual(['100% Rust', 'Postgres tips']);
    expect(await titles({ q: 'rust' })).toEqual(['Rust ownership', '100% Rust', 'Rust jobs']);
    expect(await titles({ q: 'rust', platform: 'reddit' })).toEqual(['Rust jobs']);
    // `%` is matched literally, not as a wildcard.
    expect(await titles({ q: '100%' })).toEqual(['100% Rust']);
    expect(await titles({ q: '%' })).toEqual(['100% Rust']);
  });

  it('only ever shows the caller’s bookmarks', async () => {
    const { agent: owner } = await signIn(app, 'owner@example.com');
    await seed(owner);
    const { agent: other } = await signIn(app, 'other@example.com');
    expect((await list(other, { view: 'all' })).items).toEqual([]);
  });

  it('rejects bad query parameters', async () => {
    const { agent } = await signIn(app);
    await agent.get('/bookmarks').query({ view: 'nope' }).expect(400);
    await agent.get('/bookmarks').query({ limit: 1000 }).expect(400);
    const res = await agent.get('/bookmarks').query({ cursor: 'garbage' }).expect(400);
    expect(res.body.error.message).toMatch(/cursor/i);
  });
});

describe('POST /bookmarks (manual add)', () => {
  it('creates a bookmark, then returns the existing one for the same page', async () => {
    const { agent } = await signIn(app);
    const first = await agent
      .post('/bookmarks')
      .send({ url: 'https://example.com/read-later?utm_source=x', title: 'Later' })
      .expect(201);
    expect(first.body).toMatchObject({
      created: true,
      bookmark: { platform: 'manual', url: 'https://example.com/read-later', title: 'Later' },
    });

    const again = await agent
      .post('/bookmarks')
      .send({ url: 'http://www.example.com/read-later/' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, bookmark: { id: first.body.bookmark.id } });
  });

  it('finds duplicates saved from other platforms', async () => {
    const { agent } = await signIn(app);
    await ingest(agent, [{ platform: 'browser', url: 'https://example.com/x' }]);
    const res = await agent.post('/bookmarks').send({ url: 'https://example.com/x' }).expect(200);
    expect(res.body.bookmark.platform).toBe('browser');
  });

  it('rejects unusable URLs', async () => {
    const { agent } = await signIn(app);
    const res = await agent.post('/bookmarks').send({ url: 'file:///etc/passwd' }).expect(400);
    expect(res.body.error).toMatchObject({
      code: 'validation_error',
      details: [{ path: 'url', message: expect.any(String) }],
    });
  });
});

describe('PATCH/DELETE /bookmarks/:id', () => {
  async function createOne(agent: Agent) {
    const res = await agent.post('/bookmarks').send({ url: 'https://example.com/a' }).expect(201);
    return res.body.bookmark as Bookmark;
  }

  it('updates status and snooze', async () => {
    const { agent } = await signIn(app);
    const bookmark = await createOne(agent);
    const until = new Date(Date.now() + 3_600_000).toISOString();

    const res = await agent
      .patch(`/bookmarks/${bookmark.id}`)
      .send({ status: 'opened', snoozeUntil: until })
      .expect(200);
    expect(res.body.bookmark).toMatchObject({ status: 'opened', snoozeUntil: until });

    const cleared = await agent
      .patch(`/bookmarks/${bookmark.id}`)
      .send({ snoozeUntil: null })
      .expect(200);
    expect(cleared.body.bookmark.snoozeUntil).toBeNull();
  });

  it('validates the patch body', async () => {
    const { agent } = await signIn(app);
    const bookmark = await createOne(agent);
    await agent.patch(`/bookmarks/${bookmark.id}`).send({}).expect(400);
    await agent.patch(`/bookmarks/${bookmark.id}`).send({ status: 'deleted' }).expect(400);
  });

  it('deletes a bookmark', async () => {
    const { agent } = await signIn(app);
    const bookmark = await createOne(agent);
    await agent.delete(`/bookmarks/${bookmark.id}`).expect(204);
    await agent.delete(`/bookmarks/${bookmark.id}`).expect(404);
  });

  it("returns 404 for another user's bookmark or a malformed id", async () => {
    const { agent: owner } = await signIn(app, 'owner@example.com');
    const bookmark = await createOne(owner);
    const { agent: other } = await signIn(app, 'other@example.com');

    await other.patch(`/bookmarks/${bookmark.id}`).send({ status: 'done' }).expect(404);
    await other.delete(`/bookmarks/${bookmark.id}`).expect(404);
    await owner.patch('/bookmarks/not-a-uuid').send({ status: 'done' }).expect(404);

    const [row] = await harness.db.select().from(bookmarks);
    expect(row!.status).toBe('unread');
  });
});

describe('POST /bookmarks/remove', () => {
  it('removes bookmarks deleted at the source, matching URL variants', async () => {
    const { agent } = await signIn(app);
    await ingest(agent, [
      { platform: 'browser', url: 'https://example.com/a' },
      { platform: 'browser', url: 'https://example.com/b' },
      { platform: 'x', externalId: '9', url: 'https://x.com/u/status/9' },
    ]);

    const res = await agent
      .post('/bookmarks/remove')
      .send({ platform: 'browser', urls: ['http://www.example.com/a/', 'not a url'] })
      .expect(200);
    expect(res.body).toEqual({ removed: 1 });

    const byId = await agent
      .post('/bookmarks/remove')
      .send({ platform: 'x', externalIds: ['9'] })
      .expect(200);
    expect(byId.body).toEqual({ removed: 1 });

    expect((await list(agent, { view: 'all' })).items.map((item) => item.url)).toEqual([
      'https://example.com/b',
    ]);
  });
});
