import { describe, expect, it } from 'vitest';
import { devLoginInputSchema } from './auth';

describe('devLoginInputSchema', () => {
  it('trims and lowercases the email', () => {
    expect(devLoginInputSchema.parse({ email: '  Ada@Example.COM ' })).toEqual({
      email: 'ada@example.com',
    });
  });

  it('rejects an invalid email', () => {
    expect(devLoginInputSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects a blank name', () => {
    expect(devLoginInputSchema.safeParse({ email: 'a@b.co', name: '   ' }).success).toBe(false);
  });
});
