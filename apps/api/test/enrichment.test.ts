import { bookmarkEmbeddings, bookmarks, EMBEDDING_DIMENSIONS } from '@bc/db';
import type { Bookmark, IngestItem, ServerEvent } from '@bc/shared';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/context';
import { AiError } from '../src/modules/ai/ai-error';
import type { Embedder } from '../src/modules/ai/embedder';
import type { Enricher, Enrichment, EnrichmentInput } from '../src/modules/ai/enricher';
import type { EnrichmentService } from '../src/modules/ai/enrichment.service';
import { createEnrichmentWorker } from '../src/modules/ai/enrichment.worker';
import { createTestHarness, signIn } from './harness';

const harness = createTestHarness();
afterAll(() => harness.close());

const thread: IngestItem = {
  platform: 'x',
  externalId: '1',
  url: 'https://x.com/dbnerd/status/1',
  title: "Your Postgres index isn't being used? 7 reasons why 🧵",
  author: '@dbnerd',
  text: "Your Postgres index isn't being used? 7 reasons why 🧵 1/ Functions on the column…",
};

const enrichment: Enrichment = {
  headline: 'Why Postgres ignores your index',
  summary: 'Seven reasons: functions on columns, implicit casts, stale statistics, …',
  topics: ['postgres', 'databases', 'performance'],
  contentType: 'tutorial',
  readMinutes: 4,
  shelfLife: 'evergreen',
};

/** A scriptable stand-in for Claude: answers with `enrichment` unless told otherwise. */
function fakeEnricher() {
  const enrich = vi.fn<(input: EnrichmentInput, signal?: AbortSignal) => Promise<Enrichment>>(() =>
    Promise.resolve(enrichment),
  );
  const enricher: Enricher = { model: 'fake-claude', enrich };
  return { enricher, enrich };
}

function fakeEmbedder(model = 'fake-voyage') {
  const embed = vi.fn((texts: string[]) =>
    Promise.resolve(texts.map(() => Array<number>(EMBEDDING_DIMENSIONS).fill(0.5))),
  );
  const embedder: Embedder = { model, embed: (texts) => embed(texts) };
  return { embedder, embed };
}

type Agent = Awaited<ReturnType<typeof signIn>>['agent'];

async function setup(embedder: Embedder | null = null) {
  const fake = fakeEnricher();
  const { app, ctx } = harness.createAppWithContext({}, { enricher: fake.enricher, embedder });
  const { agent, userId } = await signIn(app);
  return { app, ctx, agent, userId, enrich: fake.enrich, service: ctx.enrichment! };
}

async function ingest(agent: Agent, items: IngestItem[]) {
  await agent.post('/bookmarks/ingest').send({ items }).expect(200);
}

async function listItems(agent: Agent, query: Record<string, string> = {}): Promise<Bookmark[]> {
  return ((await agent.get('/bookmarks').query(query).expect(200)).body as { items: Bookmark[] })
    .items;
}

async function drain(service: EnrichmentService) {
  while ((await service.processBatch()).claimed > 0);
}

beforeEach(() => harness.reset());

describe('bookmark DTO', () => {
  it('reports ai: null when enrichment is off', async () => {
    const app = harness.createApp();
    const { agent } = await signIn(app);
    await ingest(agent, [thread]);
    expect((await listItems(agent))[0]!.ai).toBeNull();
  });

  it('shows pending, then the enrichment once processed', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(agent, [thread]);
    expect((await listItems(agent))[0]!.ai).toEqual({
      status: 'pending',
      headline: null,
      summary: null,
      topics: [],
      contentType: null,
      readMinutes: null,
      shelfLife: null,
    });

    await expect(service.processBatch()).resolves.toEqual({ claimed: 1, pauseMs: null });
    expect(enrich.mock.lastCall![0]).toMatchObject({
      platform: 'x',
      author: '@dbnerd',
      text: thread.text,
    });
    const [bookmark] = await listItems(agent);
    expect(bookmark!.ai).toEqual({ status: 'done', ...enrichment });
  });

  it('keeps showing finished enrichments after AI is turned off', async () => {
    const { agent, service } = await setup();
    await ingest(agent, [thread]);
    await drain(service);

    const offApp = harness.createApp();
    const { agent: offAgent } = await signIn(offApp);
    expect((await listItems(offAgent))[0]!.ai?.headline).toBe(enrichment.headline);
  });
});

describe('enrichment queue', () => {
  it('re-enriches only when the words change', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(agent, [thread]);
    await drain(service);

    // Same content, new metadata (e.g. moved to another folder): nothing to redo.
    await ingest(agent, [{ ...thread, metadata: { folder: 'Later' } }]);
    expect((await listItems(agent))[0]!.ai?.status).toBe('done');

    await ingest(agent, [{ ...thread, text: `${thread.text} 2/ Implicit casts…` }]);
    expect((await listItems(agent))[0]!.ai?.status).toBe('pending');
    await drain(service);
    expect(enrich).toHaveBeenCalledTimes(2);
  });

  it('discards a result when the content changed while it was being written', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(agent, [thread]);
    enrich.mockImplementationOnce(async () => {
      await ingest(agent, [{ ...thread, text: 'Edited while Claude was reading' }]);
      return enrichment;
    });

    await service.processBatch();
    expect((await listItems(agent))[0]!.ai?.status).toBe('pending');
    await service.processBatch();
    expect(enrich.mock.lastCall![0].text).toBe('Edited while Claude was reading');
    expect((await listItems(agent))[0]!.ai?.status).toBe('done');
  });

  it('backs off after a failure and gives up after the last attempt', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(agent, [thread]);
    enrich.mockRejectedValue(new AiError('item', 'Unusable response'));

    for (let attempt = 1; attempt <= 4; attempt++) {
      // Make the row due again instead of waiting out the backoff.
      await harness.db.update(bookmarks).set({ enrichmentRetryAt: null });
      await expect(service.processBatch()).resolves.toEqual({ claimed: 1, pauseMs: null });
      const [row] = await harness.db.select().from(bookmarks);
      expect(row).toMatchObject({
        enrichmentAttempts: attempt,
        enrichmentError: 'Unusable response',
      });
      if (attempt < 4) {
        expect(row!.enrichmentStatus).toBe('pending');
        expect(row!.enrichmentRetryAt!.getTime()).toBeGreaterThan(Date.now());
      }
    }
    expect((await listItems(agent))[0]!.ai?.status).toBe('failed');
    await expect(service.processBatch()).resolves.toEqual({ claimed: 0, pauseMs: null });
  });

  it('gives up at once when the model declines', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(agent, [thread]);
    enrich.mockRejectedValue(new AiError('refused', 'Declined'));
    await service.processBatch();
    expect((await listItems(agent))[0]!.ai?.status).toBe('failed');
  });

  it('pauses without charging the bookmark when the provider is down', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(agent, [thread]);
    enrich.mockRejectedValue(new AiError('service', 'Rate limited', 30_000));
    const [before] = await harness.db.select().from(bookmarks);

    await expect(service.processBatch()).resolves.toEqual({
      claimed: 1,
      pauseMs: 30_000,
      pauseReason: 'Rate limited',
    });
    const [row] = await harness.db.select().from(bookmarks);
    expect(row).toMatchObject({ enrichmentStatus: 'pending', enrichmentAttempts: 0 });
    // Queue bookkeeping isn't a content change.
    expect(row!.updatedAt).toEqual(before!.updatedAt);
    expect(await service.nextRetryAt()).toEqual(row!.enrichmentRetryAt);
    expect((await listItems(agent))[0]!.ai?.status).toBe('pending');
  });

  it('enriches the newest bookmarks first', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(
      agent,
      ['2026-01-01', '2026-03-01', '2026-02-01', '2026-04-01'].map((day, index) => ({
        platform: 'browser',
        url: `https://example.com/${index}`,
        title: day,
        savedAt: `${day}T00:00:00.000Z`,
      })),
    );
    // A batch runs concurrently, so only which rows it took matters, not their order.
    await service.processBatch();
    expect(enrich.mock.calls.map(([input]) => input.title).sort()).toEqual([
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
    ]);
  });
});

describe('search', () => {
  it('finds bookmarks by AI topic and summary', async () => {
    const { agent, service, enrich } = await setup();
    await ingest(agent, [thread, { platform: 'browser', url: 'https://example.com/cats' }]);
    enrich.mockImplementation((input) =>
      Promise.resolve(
        input.platform === 'x'
          ? enrichment
          : { ...enrichment, headline: 'Cats', summary: 'All about cats.', topics: ['cats'] },
      ),
    );
    await drain(service);

    const platforms = async (q: string) => (await listItems(agent, { q })).map((b) => b.platform);
    expect(await platforms('Performance')).toEqual(['x']);
    expect(await platforms('implicit casts')).toEqual(['x']);
    expect(await platforms('cats')).toEqual(['browser']);
  });
});

describe('embeddings', () => {
  it('embeds enriched bookmarks once, and again when they are re-enriched', async () => {
    const { embedder, embed } = fakeEmbedder();
    const { agent, service, userId } = await setup(embedder);
    await ingest(agent, [thread]);

    expect(await service.embedBatch()).toBe(0); // Nothing enriched yet.
    await drain(service);
    expect(await service.embedBatch()).toBe(1);
    expect(embed.mock.calls[0]![0][0]).toContain('Why Postgres ignores your index');
    expect(embed.mock.calls[0]![0][0]).toContain('Topics: postgres, databases, performance');

    const [stored] = await harness.db.select().from(bookmarkEmbeddings);
    expect(stored).toMatchObject({ userId, model: 'fake-voyage' });
    expect(stored!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(await service.embedBatch()).toBe(0);

    await ingest(agent, [{ ...thread, text: 'Rewritten' }]);
    await drain(service);
    expect(await service.embedBatch()).toBe(1);
  });

  it('re-embeds everything when the embedding model changes', async () => {
    const first = await setup(fakeEmbedder('model-a').embedder);
    await ingest(first.agent, [thread]);
    await drain(first.service);
    await first.service.embedBatch();

    const { ctx } = harness.createAppWithContext(
      {},
      { enricher: fakeEnricher().enricher, embedder: fakeEmbedder('model-b').embedder },
    );
    expect(await ctx.enrichment!.embedBatch()).toBe(1);
    const [stored] = await harness.db
      .select({ model: bookmarkEmbeddings.model })
      .from(bookmarkEmbeddings)
      .where(eq(bookmarkEmbeddings.userId, first.userId));
    expect(stored!.model).toBe('model-b');
  });

  it('deletes the vector with its bookmark', async () => {
    const { agent, service } = await setup(fakeEmbedder().embedder);
    await ingest(agent, [thread]);
    await drain(service);
    await service.embedBatch();
    const [bookmark] = await listItems(agent);
    await agent.delete(`/bookmarks/${bookmark!.id}`).expect(204);
    expect(await harness.db.select().from(bookmarkEmbeddings)).toHaveLength(0);
  });
});

describe('worker', () => {
  function startWorker(ctx: AppContext) {
    const worker = createEnrichmentWorker({
      service: ctx.enrichment!,
      events: ctx.events,
      logger: pino({ level: 'silent' }),
    });
    worker.start();
    return worker;
  }

  it('wakes on ingest, enriches and embeds, and tells open tabs', async () => {
    const { embedder } = fakeEmbedder();
    const { ctx, agent, userId } = await setup(embedder);
    const worker = startWorker(ctx);
    await worker.idle();
    const received: ServerEvent[] = [];
    ctx.events.subscribe(userId, (event) => received.push(event));

    try {
      await ingest(agent, [thread]);
      await worker.idle();
      expect((await listItems(agent))[0]!.ai?.status).toBe('done');
      expect(await harness.db.select().from(bookmarkEmbeddings)).toHaveLength(1);
      expect(received).toContainEqual({ type: 'bookmarks.changed', reason: 'enrich' });
    } finally {
      await worker.stop();
    }
  });

  it('embeds what is done while the provider is rate limited, not only once the queue empties', async () => {
    const { embedder } = fakeEmbedder();
    const { ctx, agent, enrich } = await setup(embedder);
    await ingest(agent, [thread, { platform: 'browser', url: 'https://example.com/later' }]);
    enrich.mockImplementation((input) =>
      input.platform === 'x'
        ? Promise.resolve(enrichment)
        : Promise.reject(new AiError('service', 'Rate limited', 60_000)),
    );

    const worker = startWorker(ctx);
    try {
      await worker.idle();
      const statuses = (await harness.db.select().from(bookmarks)).map((b) => b.enrichmentStatus);
      expect(statuses.sort()).toEqual(['done', 'pending']); // The backlog isn't finished…
      expect(await harness.db.select().from(bookmarkEmbeddings)).toHaveLength(1); // …but this is.
    } finally {
      await worker.stop();
    }
  });

  it('hands claimed rows back when stopped mid-batch', async () => {
    const { ctx, agent, enrich } = await setup();
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => (started = resolve));
    enrich.mockImplementation((_input, signal) => {
      started();
      // Never answers; only the abort ends it, as it would a slow API call.
      return new Promise<Enrichment>((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new Error('Aborted'))),
      );
    });
    await ingest(agent, [thread]);

    const worker = startWorker(ctx);
    await inFlight;
    await worker.stop();

    const [row] = await harness.db.select().from(bookmarks);
    expect(row).toMatchObject({
      enrichmentStatus: 'pending',
      enrichmentAttempts: 0,
      enrichmentRetryAt: null,
    });
  });
});
