import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../lib/http-error';

/**
 * Per-IP rate limiter. Uses the in-memory store, which is correct for a single instance;
 * switch to a shared store (e.g. Redis) before running more than one API replica.
 */
export function createRateLimiter({
  windowMs,
  limit,
  onlyFailures = false,
}: {
  windowMs: number;
  limit: number;
  /** Count only requests that fail (status >= 400), e.g. wrong passwords. */
  onlyFailures?: boolean;
}) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests: onlyFailures,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new HttpError(429, 'rate_limited', 'Too many requests, please slow down'));
    },
  });
}
