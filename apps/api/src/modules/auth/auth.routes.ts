import { type AuthProviders, devLoginInputSchema } from '@bc/shared';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { HttpError } from '../../lib/http-error';
import { generateToken, safeEqual } from '../../lib/tokens';
import { createRateLimiter } from '../../middleware/rate-limit';
import { toUserDto } from '../users/user.repository';
import { buildAuthorizationUrl, exchangeCodeForProfile } from './google';
import {
  baseCookieOptions,
  clearSessionCookie,
  readCookie,
  readSessionToken,
  setSessionCookie,
} from './session-cookie';

const OAUTH_COOKIE_NAME = 'bc_oauth';
const OAUTH_COOKIE_PATH = '/auth/google';
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export function createAuthRouter(ctx: AppContext): Router {
  const { env, google, sessions, users } = ctx;
  const router = Router();

  router.use(createRateLimiter({ windowMs: 60_000, limit: 30 }));

  /** Starts a session for the user, replacing any session the browser already had. */
  async function signIn(req: Request, res: Response, userId: string): Promise<void> {
    const previousToken = readSessionToken(req);
    if (previousToken) await sessions.revoke(previousToken);

    const { token, expiresAt } = await sessions.create(userId, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });
    setSessionCookie(res, env, token, expiresAt);
  }

  function redirectToLogin(res: Response, error: string): void {
    const url = new URL('/login', env.WEB_URL);
    url.searchParams.set('error', error);
    res.redirect(url.toString());
  }

  router.get('/providers', (_req, res) => {
    res.json({ google: google !== null, devLogin: env.AUTH_DEV_LOGIN } satisfies AuthProviders);
  });

  router.get('/google', (_req, res) => {
    if (!google) throw HttpError.serviceUnavailable('Google sign-in is not configured');

    const state = generateToken();
    const codeVerifier = generateToken(48);
    res.cookie(OAUTH_COOKIE_NAME, `${state}.${codeVerifier}`, {
      ...baseCookieOptions(env),
      path: OAUTH_COOKIE_PATH,
      maxAge: OAUTH_COOKIE_TTL_MS,
    });
    res.redirect(buildAuthorizationUrl(google, { state, codeVerifier }));
  });

  router.get('/google/callback', async (req, res) => {
    const stored = readCookie(req, OAUTH_COOKIE_NAME);
    res.clearCookie(OAUTH_COOKIE_NAME, { ...baseCookieOptions(env), path: OAUTH_COOKIE_PATH });

    if (!google) return redirectToLogin(res, 'google_unavailable');

    const query = callbackQuerySchema.safeParse(req.query);
    if (!query.success) {
      // Covers the user pressing "Cancel" on the consent screen (`?error=access_denied`).
      return redirectToLogin(res, 'google_cancelled');
    }

    const [expectedState, codeVerifier] = stored?.split('.') ?? [];
    if (!expectedState || !codeVerifier || !safeEqual(expectedState, query.data.state)) {
      return redirectToLogin(res, 'invalid_state');
    }

    let profile;
    try {
      profile = await exchangeCodeForProfile(google, { code: query.data.code, codeVerifier });
    } catch (error) {
      req.log.warn({ err: error }, 'Google sign-in failed');
      return redirectToLogin(res, 'google_failed');
    }

    const user = await users.upsertFromGoogle(profile);
    await signIn(req, res, user.id);
    res.redirect(new URL('/inbox', env.WEB_URL).toString());
  });

  router.post('/dev-login', async (req, res) => {
    if (!env.AUTH_DEV_LOGIN) throw HttpError.notFound('Route not found');

    const input = devLoginInputSchema.parse(req.body);
    const user = await users.findOrCreateByEmail(input);
    await signIn(req, res, user.id);
    res.json({ user: toUserDto(user) });
  });

  router.post('/logout', async (req, res) => {
    const token = readSessionToken(req);
    if (token) await sessions.revoke(token);
    clearSessionCookie(res, env);
    res.status(204).end();
  });

  return router;
}
