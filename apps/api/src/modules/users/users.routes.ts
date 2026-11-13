import { setPasswordInputSchema } from '@bc/shared';
import { Router } from 'express';
import type { AppContext } from '../../context';
import { HttpError } from '../../lib/http-error';
import { hashPassword, verifyPassword } from '../../lib/password';
import { createRateLimiter } from '../../middleware/rate-limit';
import { getAuthUser, requireAuth } from '../../middleware/require-auth';
import { readSessionToken } from '../auth/session-cookie';
import { toUserDto } from './user.repository';

export function createUsersRouter(ctx: AppContext): Router {
  const { sessions, users } = ctx;
  const router = Router();

  router.get('/me', requireAuth(ctx), (req, res) => {
    res.json({ user: toUserDto(getAuthUser(req)) });
  });

  /**
   * Sets a password (e.g. for an account made with Google) or changes it. Browser sessions
   * only: an extension token must not be able to take over the account. Changing it signs
   * out every other session, in case the old password was the reason for the change.
   */
  router.put(
    '/me/password',
    requireAuth(ctx, { methods: ['session'] }),
    // Counts wrong current passwords only, so it can't be used to guess one.
    createRateLimiter({ windowMs: 15 * 60_000, limit: 10, onlyFailures: true }),
    async (req, res) => {
      const user = getAuthUser(req);
      const input = setPasswordInputSchema.parse(req.body);

      if (user.passwordHash) {
        if (!input.currentPassword) {
          throw HttpError.badRequest('Enter your current password', [
            { path: 'currentPassword', message: 'Enter your current password' },
          ]);
        }
        // 403, not 401: a wrong password here doesn't mean the session ended.
        if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
          throw HttpError.forbidden('Current password is incorrect', [
            { path: 'currentPassword', message: 'Current password is incorrect' },
          ]);
        }
      }

      const updated = await users.setPasswordHash(user.id, await hashPassword(input.newPassword));
      const token = readSessionToken(req);
      if (token) await sessions.revokeOthers(user.id, token);
      res.json({ user: toUserDto(updated) });
    },
  );

  return router;
}
