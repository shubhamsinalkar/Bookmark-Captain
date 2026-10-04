import { Router } from 'express';
import type { AppContext } from '../../context';
import { getAuthUser, requireAuth } from '../../middleware/require-auth';
import { toUserDto } from './user.repository';

export function createUsersRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/me', requireAuth(ctx), (req, res) => {
    res.json({ user: toUserDto(getAuthUser(req)) });
  });

  return router;
}
