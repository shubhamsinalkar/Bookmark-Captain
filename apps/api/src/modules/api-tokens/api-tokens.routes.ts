import { createApiTokenRequestSchema } from '@bc/shared';
import { Router } from 'express';
import type { AppContext } from '../../context';
import { HttpError } from '../../lib/http-error';
import { parseIdParam } from '../../lib/params';
import { getAuthUser, requireAuth } from '../../middleware/require-auth';
import { toApiTokenSummary } from './api-token.service';

export function createApiTokensRouter(ctx: AppContext): Router {
  const router = Router();

  /** Lets a client (e.g. the extension on disconnect) revoke the token it is using. */
  router.delete('/current', requireAuth(ctx, { methods: ['token'] }), async (req, res) => {
    if (req.auth?.method !== 'token') throw HttpError.unauthorized();
    await ctx.apiTokens.revoke(req.auth.user.id, req.auth.tokenId);
    res.status(204).end();
  });

  // Everything else needs a real browser session: an API token must not mint or list others.
  router.use(requireAuth(ctx, { methods: ['session'] }));

  router.get('/', async (req, res) => {
    const rows = await ctx.apiTokens.list(getAuthUser(req).id);
    res.json({ items: rows.map(toApiTokenSummary) });
  });

  router.post('/', async (req, res) => {
    const { name } = createApiTokenRequestSchema.parse(req.body);
    const created = await ctx.apiTokens.create(getAuthUser(req).id, name);
    res.status(201).set('cache-control', 'no-store').json(created);
  });

  router.delete('/:id', async (req, res) => {
    const id = parseIdParam(req.params.id, 'API token');
    const revoked = await ctx.apiTokens.revoke(getAuthUser(req).id, id);
    if (!revoked) throw HttpError.notFound('API token not found');
    res.status(204).end();
  });

  return router;
}
