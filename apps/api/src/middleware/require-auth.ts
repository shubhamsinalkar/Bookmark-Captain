import type { UserRow } from '@bc/db';
import type { Request, RequestHandler } from 'express';
import type { AppContext } from '../context';
import { HttpError } from '../lib/http-error';
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
} from '../modules/auth/session-cookie';

type AuthMethod = NonNullable<Request['auth']>['method'];

const BEARER_PREFIX = 'bearer ';

function readBearerToken(req: Request): string | undefined {
  const header = req.get('authorization');
  if (!header?.toLowerCase().startsWith(BEARER_PREFIX)) return undefined;
  return header.slice(BEARER_PREFIX.length).trim() || undefined;
}

/**
 * Authenticates the request with an API token (`Authorization: Bearer …`) or, failing that,
 * the session cookie. `methods` restricts which are accepted: sensitive endpoints such as
 * minting new API tokens accept browser sessions only, so a leaked token can't escalate.
 */
export function requireAuth(
  { env, sessions, apiTokens }: AppContext,
  { methods = ['session', 'token'] }: { methods?: AuthMethod[] } = {},
): RequestHandler {
  return async (req, res, next) => {
    const bearer = readBearerToken(req);
    if (bearer !== undefined) {
      if (!methods.includes('token')) {
        throw HttpError.forbidden('This action requires signing in on the website');
      }
      const result = await apiTokens.authenticate(bearer);
      if (!result) throw HttpError.unauthorized('Invalid or expired API token');
      req.auth = { method: 'token', user: result.user, tokenId: result.tokenId };
      next();
      return;
    }

    const token = methods.includes('session') ? readSessionToken(req) : undefined;
    const session = token ? await sessions.validate(token) : null;
    if (!token || !session) {
      if (token) clearSessionCookie(res, env);
      throw HttpError.unauthorized();
    }
    if (session.renewed) {
      setSessionCookie(res, env, token, session.expiresAt);
    }

    req.auth = { method: 'session', user: session.user };
    next();
  };
}

/** Returns the signed-in user. Only valid in handlers mounted behind `requireAuth`. */
export function getAuthUser(req: Request): UserRow {
  if (!req.auth) throw HttpError.unauthorized();
  return req.auth.user;
}
