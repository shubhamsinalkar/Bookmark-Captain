import type { BookmarkRow } from '@bc/db';
import {
  type BookmarkPage,
  createBookmarkRequestSchema,
  type IngestResult,
  ingestItemSchema,
  ingestRequestSchema,
  listBookmarksQuerySchema,
  removeBySourceRequestSchema,
  type SearchByMeaningResult,
  searchByMeaningQuerySchema,
  updateBookmarkRequestSchema,
} from '@bc/shared';
import { Router } from 'express';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import { HttpError } from '../../lib/http-error';
import { parseIdParam } from '../../lib/params';
import { createRateLimiter } from '../../middleware/rate-limit';
import { getAuthUser, requireAuth } from '../../middleware/require-auth';
import { AiError } from '../ai/ai-error';
import { toBookmarkDto } from './bookmark.service';

/** "url: Too big: expected string to have <=4096 characters" — the first issue is enough. */
function describeIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (!issue) return 'Invalid item';
  return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

export function createBookmarksRouter(ctx: AppContext): Router {
  const { bookmarks } = ctx;
  const aiEnabled = ctx.enrichment !== null;
  const toDto = (row: BookmarkRow) => toBookmarkDto(row, aiEnabled);
  const router = Router();
  router.use(requireAuth(ctx));

  router.get('/', async (req, res) => {
    const query = listBookmarksQuerySchema.parse(req.query);
    const { rows, nextCursor } = await bookmarks.list(getAuthUser(req).id, query);
    res.json({ items: rows.map(toDto), nextCursor } satisfies BookmarkPage);
  });

  // Search by meaning. Its own limiter: each new query is a call to the embedding provider.
  router.get('/search', createRateLimiter({ windowMs: 60_000, limit: 30 }), async (req, res) => {
    const query = searchByMeaningQuerySchema.parse(req.query);
    if (!ctx.search) {
      res.json({
        available: false,
        items: [],
        indexed: 0,
        total: 0,
      } satisfies SearchByMeaningResult);
      return;
    }
    let result;
    try {
      result = await ctx.search.search(getAuthUser(req).id, query);
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      req.log.warn({ err: error }, 'Search by meaning failed');
      throw HttpError.serviceUnavailable(
        'Search by meaning is busy right now. Try again in a minute.',
      );
    }
    res.json({
      available: true,
      items: result.matches.map(({ row, similarity }) => ({ bookmark: toDto(row), similarity })),
      indexed: result.indexed,
      total: result.total,
    } satisfies SearchByMeaningResult);
  });

  router.get('/sources', async (req, res) => {
    res.json({ sources: await bookmarks.sources(getAuthUser(req).id) });
  });

  router.get('/counts', async (req, res) => {
    res.json(await bookmarks.counts(getAuthUser(req).id));
  });

  router.post('/', async (req, res) => {
    const input = createBookmarkRequestSchema.parse(req.body);
    const { bookmark, created } = await bookmarks.create(getAuthUser(req).id, input);
    res.status(created ? 201 : 200).json({ bookmark: toDto(bookmark), created });
  });

  router.post('/ingest', createRateLimiter({ windowMs: 60_000, limit: 120 }), async (req, res) => {
    const { items } = ingestRequestSchema.parse(req.body);

    // Validate per item: invalid ones are reported, the rest are still saved.
    const valid: { index: number; item: z.output<typeof ingestItemSchema> }[] = [];
    const rejected: IngestResult['rejected'] = [];
    items.forEach((raw, index) => {
      const parsed = ingestItemSchema.safeParse(raw);
      if (parsed.success) valid.push({ index, item: parsed.data });
      else rejected.push({ index, reason: describeIssue(parsed.error) });
    });

    const result = await bookmarks.ingest(
      getAuthUser(req).id,
      valid.map(({ item }) => item),
    );
    // The service indexes into the valid subset; map back to the caller's positions.
    for (const { index, reason } of result.rejected) {
      const original = valid[index];
      if (original) rejected.push({ index: original.index, reason });
    }
    rejected.sort((a, b) => a.index - b.index);
    res.json({ created: result.created, updated: result.updated, rejected } satisfies IngestResult);
  });

  router.post('/remove', async (req, res) => {
    const input = removeBySourceRequestSchema.parse(req.body);
    res.json({ removed: await bookmarks.removeBySource(getAuthUser(req).id, input) });
  });

  router.patch('/:id', async (req, res) => {
    const id = parseIdParam(req.params.id, 'Bookmark');
    const patch = updateBookmarkRequestSchema.parse(req.body);
    const row = await bookmarks.update(getAuthUser(req).id, id, patch);
    if (!row) throw HttpError.notFound('Bookmark not found');
    res.json({ bookmark: toDto(row) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseIdParam(req.params.id, 'Bookmark');
    const deleted = await bookmarks.delete(getAuthUser(req).id, id);
    if (!deleted) throw HttpError.notFound('Bookmark not found');
    res.status(204).end();
  });

  return router;
}
