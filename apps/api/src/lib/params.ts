import { z } from 'zod';
import { HttpError } from './http-error';

const uuidSchema = z.uuid();

/** Parses a UUID route parameter. A malformed id can't match anything, so it's a 404. */
export function parseIdParam(value: unknown, resource: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw HttpError.notFound(`${resource} not found`);
  return result.data;
}
