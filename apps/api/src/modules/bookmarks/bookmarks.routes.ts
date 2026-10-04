import {
  type BookmarkPage,
  createBookmarkRequestSchema,
  type IngestResult,
  ingestItemSchema,
  ingestRequestSchema,
  listBookmarksQuerySchema,
  removeBySourceRequestSchema,
  updateBookmarkRequestSchema,
} from '@bc/shared';
import { Router } from 'express';
import type { z } from 'zod';
import type { AppContext } from '../../context';
import { HttpError } from '../../lib/http-error';
import { parseIdParam } from '../../lib/params';
import { createRateLimiter } from '../../middleware/rate-limit';
import { getAuthUser, requireAuth } from '../../middleware/require-auth';
import { toBookmarkDto } from './bookmark.service';

/** "url: Too big: expected string to have <=4096 characters" — the first issue is enough. */
function describeIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (!issue) return 'Invalid item';
  return issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

export function createBookmarksRouter(ctx: AppContext): Router {
  const { bookmarks } = ctx;
  const router = Router();
  router.use(requireAuth(ctx));

  router.get('/', async (req, res) => {
    const query = listBookmarksQuerySchema.parse(req.query);
    const { rows, nextCursor } = await bookmarks.list(getAuthUser(req).id, query);
    res.json({ items: rows.map(toBookmarkDto), nextCursor } satisfies BookmarkPage);
  });

  router.get('/sources', async (req, res) => {
    res.json({ sources: await bookmarks.sources(getAuthUser(req).id) });
  });

  router.post('/', async (req, res) => {
    const input = createBookmarkRequestSchema.parse(req.body);
    const { bookmark, created } = await bookmarks.create(getAuthUser(req).id, input);
    res.status(created ? 201 : 200).json({ bookmark: toBookmarkDto(bookmark), created });
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
    res.json({ bookmark: toBookmarkDto(row) });
  });

  router.delete('/:id', async (req, res) => {
    const id = parseIdParam(req.params.id, 'Bookmark');
    const deleted = await bookmarks.delete(getAuthUser(req).id, id);
    if (!deleted) throw HttpError.notFound('Bookmark not found');
    res.status(204).end();
  });

  return router;
}
