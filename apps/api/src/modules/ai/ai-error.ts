/**
 * Why an AI call failed, which decides what the worker does next:
 * - `item`: this bookmark failed; retry it later and count the attempt.
 * - `refused`: the model declined this content; retrying won't help.
 * - `service`: the provider is down, rate limiting or misconfigured; pause all work and retry
 *   without counting it against any bookmark.
 */
export type AiFailureKind = 'item' | 'refused' | 'service';

export class AiError extends Error {
  constructor(
    readonly kind: AiFailureKind,
    message: string,
    /** For `service` failures: how long to pause before trying again. */
    readonly retryAfterMs = 60_000,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** Seconds from a `Retry-After` header, as milliseconds. */
export function retryAfterMs(headers: Headers | null | undefined, fallback: number): number {
  const seconds = Number(headers?.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
}
