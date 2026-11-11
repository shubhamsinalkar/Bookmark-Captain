import {
  type AuthProviders,
  devLoginInputSchema,
  signInInputSchema,
  signUpInputSchema,
} from '@bc/shared';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { HttpError } from '../../lib/http-error';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../lib/password';
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

  // Before the limiter: it only reports configuration, and the web app's server asks for it on
  // every visit to /login. Those requests all come from that one server, so counting them
  // would lock everyone out of the login page once ~30 people opened it within a minute.
  router.get('/providers', (_req, res) => {
    res.json({
      google: google !== null,
      password: true,
      devLogin: env.AUTH_DEV_LOGIN,
    } satisfies AuthProviders);
  });

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

  // Stricter than the router-wide limit: each attempt costs a slow hash, and guessing
  // passwords is exactly what these limits stop. Sign-in counts only failed attempts, so
  // someone who types their password correctly is never locked out.
  const signUpLimiter = createRateLimiter({ windowMs: 15 * 60_000, limit: 20 });
  const signInLimiter = createRateLimiter({ windowMs: 15 * 60_000, limit: 20, onlyFailures: true });

  router.post('/signup', signUpLimiter, async (req, res) => {
    const input = signUpInputSchema.parse(req.body);
    const user = await users.createWithPassword({
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
    });
    if (!user) {
      throw HttpError.conflict('An account with this email already exists', [
        {
          path: 'email',
          message:
            'An account with this email already exists. Sign in instead, or if you used Google, continue with Google and add a password in Settings.',
        },
      ]);
    }
    await signIn(req, res, user.id);
    res.status(201).json({ user: toUserDto(user) });
  });

  router.post('/login', signInLimiter, async (req, res) => {
    const input = signInInputSchema.parse(req.body);
    const user = await users.findByEmail(input.email);
    const valid = user?.passwordHash
      ? await verifyPassword(input.password, user.passwordHash)
      : await verifyAgainstDummy(input.password);
    // One message for "no such account" and "wrong password", so nobody can probe for emails.
    if (!user || !valid) throw HttpError.unauthorized('Incorrect email or password');

    await signIn(req, res, user.id);
    res.json({ user: toUserDto(user) });
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
