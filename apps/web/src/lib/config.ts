import { z } from 'zod';

/**
 * Public API origin, inlined into the client bundle at build time.
 * `process.env.NEXT_PUBLIC_API_URL` must be referenced literally for Next.js to inline it.
 */
export const PUBLIC_API_URL = z
  .url({ error: 'NEXT_PUBLIC_API_URL must be set to the API origin' })
  .parse(process.env.NEXT_PUBLIC_API_URL);
