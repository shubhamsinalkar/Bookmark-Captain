import type { Logger } from 'pino';
import type { EventBus } from '../../lib/event-bus';
import { AiError } from './ai-error';
import type { EnrichmentService } from './enrichment.service';

/** Never wake more often than this, however soon a retry is due. */
const MIN_DELAY_MS = 1000;
/** After an unexpected error (e.g. the database dropped a connection). */
const ERROR_DELAY_MS = 60_000;
/**
 * How often to embed what's been enriched while a backlog is still being worked through. On a
 * rate-limited free tier a backlog takes days; embeddings shouldn't wait for it to empty.
 */
const EMBED_INTERVAL_MS = 60_000;

/**
 * Drains the enrichment queue in the background. It wakes when bookmarks are ingested and when
 * a backed-off retry falls due, and otherwise sleeps without touching the database, so an
 * idle Neon compute can still suspend.
 *
 * In-process like the event bus, so correct for a single API instance; the queue itself is
 * safe to share (rows are claimed with SKIP LOCKED).
 */
export function createEnrichmentWorker({
  service,
  events,
  logger,
}: {
  service: EnrichmentService;
  events: EventBus;
  logger: Logger;
}) {
  const controller = new AbortController();
  let stopped = false;
  let running: Promise<void> | null = null;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Set while the AI provider is failing as a whole; ingest events don't cut it short. */
  let pausedUntil = 0;
  let embeddingPausedUntil = 0;
  let lastEmbedAt = 0;

  function wakeAt(at: number): void {
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        pausedUntil = 0;
        kick();
      },
      Math.max(at - Date.now(), MIN_DELAY_MS),
    );
    timer.unref();
  }

  async function embedAll(): Promise<void> {
    if (Date.now() < embeddingPausedUntil) return;
    lastEmbedAt = Date.now();
    try {
      while (!stopped && (await service.embedBatch(controller.signal)) > 0);
    } catch (error) {
      if (stopped) return;
      if (!(error instanceof AiError)) throw error;
      embeddingPausedUntil = Date.now() + error.retryAfterMs;
      logger.warn({ err: error, retryInMs: error.retryAfterMs }, 'Embedding paused');
    }
  }

  async function drain(): Promise<void> {
    do {
      rerun = false;
      for (;;) {
        if (stopped) return;
        const { claimed, pauseMs, pauseReason } = await service.processBatch(controller.signal);
        if (pauseMs !== null) {
          pausedUntil = Date.now() + pauseMs;
          // Routine on free tiers (rate limits); persistent ones are usually a wrong key.
          logger.warn(
            { reason: pauseReason, resumesAt: new Date(pausedUntil).toISOString() },
            'Enrichment paused',
          );
          // Embeddings use a different provider, so a pause is a good moment for them.
          await embedAll();
          wakeAt(pausedUntil);
          return;
        }
        if (claimed === 0) break;
        if (Date.now() - lastEmbedAt >= EMBED_INTERVAL_MS) await embedAll();
      }
      await embedAll();
    } while (rerun);

    if (stopped) return;
    const wakeups = [(await service.nextRetryAt())?.getTime()];
    if (embeddingPausedUntil > Date.now()) wakeups.push(embeddingPausedUntil);
    const next = Math.min(...wakeups.filter((at): at is number => at !== undefined));
    if (Number.isFinite(next)) wakeAt(next);
  }

  function kick(): void {
    if (stopped || Date.now() < pausedUntil) return;
    if (running) {
      // Rows saved after the current claim would otherwise wait for the next wake-up.
      rerun = true;
      return;
    }
    running = drain()
      .catch((error: unknown) => {
        if (stopped) return;
        logger.error({ err: error }, 'Enrichment worker failed; retrying in a minute');
        wakeAt(Date.now() + ERROR_DELAY_MS);
      })
      .finally(() => {
        running = null;
      });
  }

  const unsubscribe = events.subscribeAll((_userId, event) => {
    if (event.type === 'bookmarks.changed' && event.reason === 'ingest') kick();
  });

  return {
    /** Starts with whatever is already queued (e.g. existing bookmarks on first run). */
    start: kick,
    kick,
    /** Resolves once the current batch has handed its rows back. */
    async stop(): Promise<void> {
      stopped = true;
      unsubscribe();
      clearTimeout(timer);
      controller.abort();
      await running;
    },
    /** Resolves when the worker is idle; for tests. */
    async idle(): Promise<void> {
      while (running) await running;
    },
  };
}

export type EnrichmentWorker = ReturnType<typeof createEnrichmentWorker>;
