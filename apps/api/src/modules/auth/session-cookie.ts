import { SESSION_COOKIE_NAME } from '@bc/shared';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../../config/env';

type CookieEnv = Pick<Env, 'API_URL' | 'COOKIE_DOMAIN'>;

export function baseCookieOptions(env: CookieEnv): CookieOptions {
  return {
    httpOnly: true,
    secure: new URL(env.API_URL).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    ...(env.COOKIE_DOMAIN && { domain: env.COOKIE_DOMAIN }),
  };
}

export function readCookie(req: Request, name: string): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readSessionToken(req: Request): string | undefined {
  return readCookie(req, SESSION_COOKIE_NAME);
}

export function setSessionCookie(res: Response, env: CookieEnv, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE_NAME, token, { ...baseCookieOptions(env), expires: expiresAt });
}

export function clearSessionCookie(res: Response, env: CookieEnv) {
  res.clearCookie(SESSION_COOKIE_NAME, baseCookieOptions(env));
}
