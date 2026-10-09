import { EMBEDDING_DIMENSIONS } from '@bc/db';
import type { IngestItem, SearchByMeaningResult } from '@bc/shared';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/context';
import { AiError } from '../src/modules/ai/ai-error';
import type { Embedder } from '../src/modules/ai/embedder';
import type { Enricher, Enrichment } from '../src/modules/ai/enricher';
import { createTestHarness, signIn } from './harness';

const harness = createTestHarness();
afterAll(() => harness.close());
beforeEach(() => harness.reset());

/**
 * A stand-in for a real embedding model: each text points along one "meaning" axis, so cooking
 * texts are close to each other and far from database texts, whatever words they use.
 */
const AXES = [/cook|dinner|recipe|rice|egg|paneer|bhurji|food/i, /postgres|database|sql|index/i];

function vectorFor(text: string): number[] {
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const axis = AXES.findIndex((pattern) => pattern.test(text));
  vector[axis === -1 ? AXES.length : axis] = 1;
  return vector;
}

function fakeEmbedder() {
  const embed = vi.fn((texts: string[], _inputType: 'document' | 'query') =>
    Promise.resolve(texts.map(vectorFor)),
  );
  const embedder: Embedder = { model: 'fake-voyage', embed };
  return { embedder, embed };
}

/** Uses the saved title as the headline, so what's searchable is easy to see in each test. */
const enricher: Enricher = {
  model: 'fake-claude',
  enrich: (input): Promise<Enrichment> =>
    Promise.resolve({
      headline: input.title ?? input.url,
      summary: input.text ?? '',
      topics: [],
      contentType: 'other',
      readMinutes: null,
      shelfLife: 'evergreen',
    }),
};

const recipe: IngestItem = {
  platform: 'x',
  externalId: '1',
  url: 'https://x.com/chef/status/1',
  title: 'Quick egg fried rice',
};
const bhurji: IngestItem = {
  platform: 'instagram',
  externalId: 'p1',
  url: 'https://www.instagram.com/p/p1/',
  title: 'Bhurji in 10 mins 🔥',
};
const postgres: IngestItem = {
  platform: 'x',
  externalId: '2',
  url: 'https://x.com/dbnerd/status/2',
  title: 'Why Postgres ignores your index',
};

type Agent = Awaited<ReturnType<typeof signIn>>['agent'];

async function setup(items: IngestItem[], options: { embedder?: Embedder } = {}) {
  const fake = fakeEmbedder();
  const embedder = options.embedder ?? fake.embedder;
  const { app, ctx } = harness.createAppWithContext({}, { enricher, embedder });
  const { agent } = await signIn(app);
  await agent.post('/bookmarks/ingest').send({ items }).expect(200);
  await index(ctx);
  return { app, ctx, agent, embed: fake.embed };
}

/** Summarises and embeds everything queued, as the worker would. */
async function index(ctx: AppContext) {
  while ((await ctx.enrichment!.processBatch()).claimed > 0);
  while ((await ctx.enrichment!.embedBatch()) > 0);
}

async function search(agent: Agent, query: Record<string, string>) {
  return (await agent.get('/bookmarks/search').query(query).expect(200))
    .body as SearchByMeaningResult;
}

const headlines = (result: SearchByMeaningResult) =>
  result.items.map((item) => item.bookmark.ai?.headline);

describe('GET /bookmarks/search', () => {
  it('reports itself unavailable without an embedding provider', async () => {
    const app = harness.createApp();
    const { agent } = await signIn(app);
    expect(await search(agent, { q: 'dinner' })).toEqual({
      available: false,
      items: [],
      indexed: 0,
      total: 0,
    });
  });

  it('finds bookmarks by meaning when no words match, closest first', async () => {
    const { agent, embed } = await setup([recipe, bhurji, postgres]);

    const result = await search(agent, { q: 'what can I cook tonight' });
    expect(headlines(result).sort()).toEqual(['Bhurji in 10 mins 🔥', 'Quick egg fried rice']);
    expect(result.items[0]!.similarity).toBeCloseTo(1);
    expect(result).toMatchObject({ available: true, indexed: 3, total: 3 });
    // The question is embedded as a query, not as a document.
    expect(embed).toHaveBeenLastCalledWith(['what can I cook tonight'], 'query');
  });

  it('can leave out what the word search already shows', async () => {
    const { agent } = await setup([recipe, bhurji, postgres]);
    const result = await search(agent, { q: 'rice', excludeWordMatches: 'true' });
    expect(headlines(result)).toEqual(['Bhurji in 10 mins 🔥']);
  });

  it('keeps to the open view and platform', async () => {
    const { agent } = await setup([recipe, bhurji]);
    const [archived] = (await search(agent, { q: 'dinner' })).items.filter(
      (item) => item.bookmark.platform === 'x',
    );
    await agent
      .patch(`/bookmarks/${archived!.bookmark.id}`)
      .send({ status: 'archived' })
      .expect(200);

    expect(headlines(await search(agent, { q: 'dinner' }))).toEqual(['Bhurji in 10 mins 🔥']);
    expect(headlines(await search(agent, { q: 'dinner', view: 'archived' }))).toEqual([
      'Quick egg fried rice',
    ]);
    expect(await search(agent, { q: 'dinner', platform: 'x' })).toMatchObject({ items: [] });
  });

  it('keeps working with summaries switched off', async () => {
    const { embedder } = fakeEmbedder();
    await setup([recipe], { embedder });
    const { app, ctx } = harness.createAppWithContext({}, { enricher: null, embedder });
    expect(ctx.enrichment).toBeNull();
    const { agent } = await signIn(app);
    expect(headlines(await search(agent, { q: 'dinner' }))).toEqual(['Quick egg fried rice']);
  });

  it("never returns another user's bookmarks", async () => {
    const { app } = await setup([recipe]);
    const { agent: other } = await signIn(app, 'grace@example.com');
    expect(await search(other, { q: 'dinner' })).toMatchObject({ items: [], indexed: 0 });
  });

  it('says how much is searchable while the backlog is still being processed', async () => {
    const { ctx, agent } = await setup([recipe]);
    await agent
      .post('/bookmarks/ingest')
      .send({ items: [postgres] })
      .expect(200);
    expect(await search(agent, { q: 'dinner' })).toMatchObject({ indexed: 1, total: 2 });
    await index(ctx);
    expect(await search(agent, { q: 'dinner' })).toMatchObject({ indexed: 2, total: 2 });
  });

  it('embeds a repeated query only once', async () => {
    const { agent, embed } = await setup([recipe]);
    const queries = () => embed.mock.calls.filter(([, type]) => type === 'query').length;
    await search(agent, { q: 'Dinner ideas' });
    await search(agent, { q: 'dinner ideas' });
    expect(queries()).toBe(1);
  });

  it('answers 503 when the embedding provider is busy', async () => {
    const fake = fakeEmbedder();
    const { agent } = await setup([recipe], { embedder: fake.embedder });
    fake.embed.mockRejectedValueOnce(new AiError('service', 'Voyage API error 429'));
    const res = await agent.get('/bookmarks/search').query({ q: 'something new' }).expect(503);
    expect(res.body.error).toMatchObject({ code: 'service_unavailable' });
  });

  it('validates the query', async () => {
    const { app } = harness.createAppWithContext(
      {},
      { enricher, embedder: fakeEmbedder().embedder },
    );
    const { agent } = await signIn(app);
    await agent.get('/bookmarks/search').query({ q: 'a' }).expect(400);
  });
});
