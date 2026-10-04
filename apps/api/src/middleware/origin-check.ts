import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated requests, on top of SameSite=Lax cookies.
 * Browsers always send `Origin` on cross-origin state-changing requests, so any unsafe
 * request from an origin we don't own is rejected. Exempt:
 *  - requests without `Origin` (non-browser clients can't ride on a victim's cookies);
 *  - bearer-token requests (e.g. the extension): browsers never attach those automatically.
 */
export function originCheck(allowedUrls: string[]): RequestHandler {
  const allowed = new Set(allowedUrls.map((url) => new URL(url).origin));

  return (req, _res, next) => {
    const origin = req.get('origin');
    const usesBearerToken = req.get('authorization')?.toLowerCase().startsWith('bearer ') ?? false;
    if (
      SAFE_METHODS.has(req.method) ||
      origin === undefined ||
      usesBearerToken ||
      allowed.has(origin)
    ) {
      next();
      return;
    }
    next(HttpError.forbidden('Cross-origin request blocked'));
  };
}
