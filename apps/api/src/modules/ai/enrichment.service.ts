import { bookmarkEmbeddings, type BookmarkRow, bookmarks, type Database } from '@bc/db';
import { and, desc, eq, inArray, isNull, lt, lte, min, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { EventBus } from '../../lib/event-bus';
import { AiError } from './ai-error';
import type { Embedder } from './embedder';
import type { Enricher } from './enricher';

export interface AiProviders {
  enricher: Enricher;
  /** Null when no embedding provider is configured: bookmarks get summaries but no vectors. */
  embedder: Embedder | null;
}

/** Bookmarks enriched concurrently per batch. */
const BATCH_SIZE = 3;
/** How long a claimed row stays reserved; a crashed worker's rows come back after this. */
const LEASE_MS = 5 * 60_000;
/** Attempts before a bookmark is marked `failed`, with the wait after each failed one. */
const BACKOFF_MS = [60_000, 10 * 60_000, 60 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
/**
 * Voyage accounts without a payment method allow 10K tokens per minute, and a request larger
 * than that can never succeed. 16 texts of at most ~500 tokens each stay under it.
 */
const EMBED_BATCH_SIZE = 16;
/** Enough of a long post for its vector to reflect the details, not just the summary. */
const EMBED_TEXT_CHARS = 2000;

export interface BatchResult {
  /** Rows taken from the queue; 0 means it is empty (or everything is backing off). */
  claimed: number;
  /** Set when the provider failed as a whole: wait this long before trying again. */
  pauseMs: number | null;
  /** Why, when pausing: e.g. a rate limit or a rejected key. */
  pauseReason?: string;
}

interface Outcome {
  userId: string;
  /** Reached a state the card shows (done or failed). */
  settled: boolean;
  /** A provider-wide failure (`service`), which pauses all work. */
  pause: AiError | null;
}

/** Keeps `updatedAt` for bookkeeping writes, so it still means "content last changed". */
const keepUpdatedAt = { updatedAt: sql`${bookmarks.updatedAt}` };

/** The text a bookmark's vector is computed from: what it is, then what it says. */
export function embeddingText(
  row: Pick<BookmarkRow, 'headline' | 'title' | 'summary' | 'topics' | 'author' | 'text'>,
): string {
  return [
    row.headline,
    row.title !== row.headline && row.title,
    row.summary,
    row.topics.length > 0 && `Topics: ${row.topics.join(', ')}`,
    row.author && `By ${row.author}`,
    row.text?.slice(0, EMBED_TEXT_CHARS),
  ]
    .filter(Boolean)
    .join('\n');
}

export function createEnrichmentService(
  db: Database,
  events: EventBus,
  logger: Logger,
  { enricher, embedder }: AiProviders,
) {
  /** Only the worker holding the current lease may write; a content change resets it. */
  const leaseHeld = (row: BookmarkRow) =>
    and(
      eq(bookmarks.id, row.id),
      eq(bookmarks.enrichmentStatus, 'pending'),
      eq(bookmarks.enrichmentRetryAt, row.enrichmentRetryAt!),
    );

  /** Reserves due rows, newest first. SKIP LOCKED keeps overlapping claims apart. */
  async function claim(limit: number): Promise<BookmarkRow[]> {
    const now = new Date();
    const due = db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.enrichmentStatus, 'pending'),
          or(isNull(bookmarks.enrichmentRetryAt), lte(bookmarks.enrichmentRetryAt, now)),
        ),
      )
      .orderBy(desc(bookmarks.savedAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    return db
      .update(bookmarks)
      .set({
        enrichmentRetryAt: new Date(now.getTime() + LEASE_MS),
        enrichmentAttempts: sql`${bookmarks.enrichmentAttempts} + 1`,
        ...keepUpdatedAt,
      })
      .where(inArray(bookmarks.id, due))
      .returning();
  }

  /** Hands a row back without counting the attempt (shutdown, or a provider-wide failure). */
  async function release(row: BookmarkRow, retryAt: Date | null): Promise<void> {
    await db
      .update(bookmarks)
      .set({
        enrichmentRetryAt: retryAt,
        enrichmentAttempts: sql`greatest(${bookmarks.enrichmentAttempts} - 1, 0)`,
        ...keepUpdatedAt,
      })
      .where(leaseHeld(row));
  }

  async function enrichOne(row: BookmarkRow, signal?: AbortSignal): Promise<Outcome> {
    const outcome = (settled: boolean, pause: AiError | null = null): Outcome => ({
      userId: row.userId,
      settled,
      pause,
    });

    try {
      const result = await enricher.enrich(
        {
          platform: row.platform,
          url: row.url,
          title: row.title,
          author: row.author,
          text: row.text,
          metadata: row.metadata,
          savedAt: row.savedAt,
        },
        signal,
      );
      const saved = await db
        .update(bookmarks)
        .set({
          ...result,
          enrichmentStatus: 'done',
          enrichmentRetryAt: null,
          enrichmentError: null,
          enrichedAt: new Date(),
        })
        .where(leaseHeld(row))
        .returning({ id: bookmarks.id });
      // No row: the content changed meanwhile, so this result is stale and the row re-queued.
      return outcome(saved.length > 0);
    } catch (error) {
      if (signal?.aborted) {
        await release(row, null);
        return outcome(false);
      }
      if (error instanceof AiError && error.kind === 'service') {
        await release(row, new Date(Date.now() + error.retryAfterMs));
        return outcome(false, error);
      }

      const message = error instanceof Error ? error.message : String(error);
      const giveUp =
        (error instanceof AiError && error.kind === 'refused') ||
        row.enrichmentAttempts >= MAX_ATTEMPTS;
      logger.warn(
        { err: error, bookmarkId: row.id, attempt: row.enrichmentAttempts, giveUp },
        'Bookmark enrichment failed',
      );
      const backoff = BACKOFF_MS[row.enrichmentAttempts - 1] ?? BACKOFF_MS.at(-1)!;
      await db
        .update(bookmarks)
        .set({
          enrichmentStatus: giveUp ? 'failed' : 'pending',
          enrichmentRetryAt: giveUp ? null : new Date(Date.now() + backoff),
          enrichmentError: message.slice(0, 1000),
          ...keepUpdatedAt,
        })
        .where(leaseHeld(row));
      return outcome(giveUp);
    }
  }

  return {
    model: enricher.model,
    embeddingModel: embedder?.model ?? null,

    /** Claims a few due bookmarks and enriches them concurrently. */
    async processBatch(signal?: AbortSignal): Promise<BatchResult> {
      const rows = await claim(BATCH_SIZE);
      if (rows.length === 0) return { claimed: 0, pauseMs: null };

      const outcomes = await Promise.all(rows.map((row) => enrichOne(row, signal)));

      // Cards waiting on a summary refresh once it lands (or once we give up on it).
      const changedUsers = new Set(outcomes.filter((o) => o.settled).map((o) => o.userId));
      for (const userId of changedUsers) {
        events.publish(userId, { type: 'bookmarks.changed', reason: 'enrich' });
      }

      // Several calls can fail at once (e.g. all rate limited); wait out the longest.
      const pause = outcomes
        .map((o) => o.pause)
        .reduce<AiError | null>(
          (longest, p) => (p && (!longest || p.retryAfterMs > longest.retryAfterMs) ? p : longest),
          null,
        );
      return pause
        ? { claimed: rows.length, pauseMs: pause.retryAfterMs, pauseReason: pause.message }
        : { claimed: rows.length, pauseMs: null };
    },

    /**
     * Embeds enriched bookmarks that have no vector yet, or a stale one (re-enriched since, or
     * from another model). Returns how many it embedded; throws `AiError` on provider failure.
     */
    async embedBatch(signal?: AbortSignal): Promise<number> {
      if (!embedder) return 0;
      const rows = await db
        .select({
          id: bookmarks.id,
          userId: bookmarks.userId,
          enrichedAt: bookmarks.enrichedAt,
          headline: bookmarks.headline,
          title: bookmarks.title,
          summary: bookmarks.summary,
          topics: bookmarks.topics,
          author: bookmarks.author,
          text: bookmarks.text,
        })
        .from(bookmarks)
        .leftJoin(bookmarkEmbeddings, eq(bookmarkEmbeddings.bookmarkId, bookmarks.id))
        .where(
          and(
            eq(bookmarks.enrichmentStatus, 'done'),
            or(
              isNull(bookmarkEmbeddings.bookmarkId),
              ne(bookmarkEmbeddings.model, embedder.model),
              lt(bookmarkEmbeddings.sourceEnrichedAt, bookmarks.enrichedAt),
            ),
          ),
        )
        .limit(EMBED_BATCH_SIZE);
      if (rows.length === 0) return 0;

      const vectors = await embedder.embed(rows.map(embeddingText), 'document', signal);
      const excluded = (column: string) => sql.raw(`excluded.${column}`);
      await db
        .insert(bookmarkEmbeddings)
        .values(
          rows.map((row, index) => ({
            bookmarkId: row.id,
            userId: row.userId,
            model: embedder.model,
            embedding: vectors[index]!,
            sourceEnrichedAt: row.enrichedAt!,
          })),
        )
        .onConflictDoUpdate({
          target: bookmarkEmbeddings.bookmarkId,
          set: {
            model: excluded('model'),
            embedding: excluded('embedding'),
            sourceEnrichedAt: excluded('source_enriched_at'),
            createdAt: new Date(),
          },
        });
      return rows.length;
    },

    /** When the earliest backed-off bookmark becomes due again, if any are waiting. */
    async nextRetryAt(): Promise<Date | null> {
      const [row] = await db
        .select({ at: min(bookmarks.enrichmentRetryAt) })
        .from(bookmarks)
        .where(eq(bookmarks.enrichmentStatus, 'pending'));
      return row?.at ?? null;
    },
  };
}

export type EnrichmentService = ReturnType<typeof createEnrichmentService>;
