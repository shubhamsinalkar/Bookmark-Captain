/**
 * Developer tool for the AI layer, run against the database in `.env` (read-only):
 *
 *   pnpm --filter @bc/api ai status              progress, errors and the latest summaries
 *   pnpm --filter @bc/api ai search "<query>"    bookmarks closest in meaning to the query
 */
import { bookmarkEmbeddings, bookmarks, createDb } from '@bc/db';
import { and, cosineDistance, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { loadEnv } from '../src/config/env';
import { AiError } from '../src/modules/ai/ai-error';
import { createVoyageEmbedder } from '../src/modules/ai/embedder';
import { aiProvidersFromEnv } from '../src/modules/ai/providers';

const env = loadEnv();
const { db, pool } = createDb({ connectionString: env.DATABASE_URL, maxConnections: 2 });

const shorten = (value: string | null, max: number) =>
  !value ? '' : value.length <= max ? value : `${value.slice(0, max - 1)}…`;

async function status(): Promise<void> {
  const providers = aiProvidersFromEnv(env);
  console.log(`AI provider:  ${providers?.enricher.model ?? 'off (see .env.example)'}`);
  console.log(`Embeddings:   ${providers?.embedder?.model ?? 'off (no VOYAGE_API_KEY)'}\n`);

  const byStatus = await db
    .select({ status: bookmarks.enrichmentStatus, n: count() })
    .from(bookmarks)
    .groupBy(bookmarks.enrichmentStatus);
  const [waiting] = await db
    .select({ n: count(), until: sql<Date | null>`max(${bookmarks.enrichmentRetryAt})` })
    .from(bookmarks)
    .where(
      and(eq(bookmarks.enrichmentStatus, 'pending'), gt(bookmarks.enrichmentRetryAt, sql`now()`)),
    );
  const [embedded] = await db.select({ n: count() }).from(bookmarkEmbeddings);

  console.log('Summaries:   ', byStatus.map(({ status, n }) => `${status} ${n}`).join(' · '));
  if (waiting && waiting.n > 0) {
    console.log(`              ${waiting.n} pending are backing off (rate limit or error retry)`);
  }
  console.log(`Embeddings:   ${embedded?.n ?? 0} stored\n`);

  const errors = await db
    .select({ error: bookmarks.enrichmentError, n: count() })
    .from(bookmarks)
    .where(isNotNull(bookmarks.enrichmentError))
    .groupBy(bookmarks.enrichmentError)
    .orderBy(desc(count()))
    .limit(3);
  if (errors.length > 0) {
    console.log('Most common errors:');
    for (const { error, n } of errors) console.log(`  ${n}× ${shorten(error, 140)}`);
    console.log();
  }

  const latest = await db
    .select()
    .from(bookmarks)
    .where(eq(bookmarks.enrichmentStatus, 'done'))
    .orderBy(desc(bookmarks.enrichedAt))
    .limit(5);
  console.log('Latest summaries:');
  for (const b of latest) {
    console.log(`\n  [${b.platform}] ${b.headline}`);
    console.log(`  was: ${shorten(b.title ?? b.url, 90)}`);
    console.log(`  ${b.summary}`);
    console.log(
      `  ${b.contentType} · ${b.readMinutes ?? '?'} min · ${b.shelfLife} · #${b.topics.join(' #')}`,
    );
  }
}

/** Free Voyage accounts allow 3 requests a minute, shared with the running API's worker. */
async function withRetries<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof AiError) || attempt === attempts) throw error;
      const waitMs = Math.min(error.retryAfterMs, 25_000);
      console.log(`Rate limited by Voyage; retrying in ${Math.round(waitMs / 1000)}s…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function search(query: string): Promise<void> {
  if (!env.VOYAGE_API_KEY) throw new Error('Search by meaning needs VOYAGE_API_KEY in .env');
  const embedder = createVoyageEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL });
  // `query` (not `document`): Voyage encodes questions so they land near their answers.
  const [vector] = await withRetries(() => embedder.embed([query], 'query'));
  const distance = cosineDistance(bookmarkEmbeddings.embedding, vector!);

  const rows = await db
    .select({
      similarity: sql<number>`1 - (${distance})`,
      platform: bookmarks.platform,
      headline: bookmarks.headline,
      title: bookmarks.title,
      url: bookmarks.url,
    })
    .from(bookmarkEmbeddings)
    .innerJoin(bookmarks, eq(bookmarks.id, bookmarkEmbeddings.bookmarkId))
    .where(eq(bookmarkEmbeddings.model, embedder.model))
    .orderBy(distance)
    .limit(8);

  if (rows.length === 0) {
    console.log('No embeddings yet. They are created a minute or so after summaries.');
    return;
  }
  console.log(`Closest in meaning to "${query}" (1.00 = same meaning):\n`);
  for (const row of rows) {
    console.log(
      `  ${Number(row.similarity).toFixed(2)}  [${row.platform}] ${shorten(row.headline ?? row.title ?? row.url, 90)}`,
    );
  }
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === 'status') await status();
  else if (command === 'search' && rest.length > 0) await search(rest.join(' '));
  else console.log('Usage: pnpm --filter @bc/api ai status | search "<query>"');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
