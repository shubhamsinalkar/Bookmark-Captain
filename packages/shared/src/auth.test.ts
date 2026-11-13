import { describe, expect, it } from 'vitest';
import { devLoginInputSchema, signInInputSchema, signUpInputSchema } from './auth';

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

describe('signUpInputSchema', () => {
  const valid = { email: ' Ada@Example.com ', password: 'correct horse', name: ' Ada ' };

  it('normalises the email and name but keeps the password exactly as typed', () => {
    expect(signUpInputSchema.parse({ ...valid, password: ' spaced out ' })).toEqual({
      email: 'ada@example.com',
      password: ' spaced out ',
      name: 'Ada',
    });
  });

  it('makes the name optional', () => {
    expect(signUpInputSchema.parse({ email: 'a@b.co', password: '12345678' })).toEqual({
      email: 'a@b.co',
      password: '12345678',
    });
  });

  it.each([
    ['an invalid email', { email: 'ada@' }, 'email', 'Enter a valid email address'],
    ['a missing email', { email: undefined }, 'email', undefined],
    ['a short password', { password: '1234567' }, 'password', 'Use at least 8 characters'],
    ['a huge password', { password: 'x'.repeat(129) }, 'password', 'Use at most 128 characters'],
    [
      'a password of spaces',
      { password: '         ' },
      'password',
      'Password cannot be only spaces',
    ],
    ['a blank name', { name: '   ' }, 'name', 'Name cannot be blank'],
    ['a long name', { name: 'x'.repeat(101) }, 'name', 'Name is too long'],
  ])('rejects %s', (_label, override, path, message) => {
    const result = signUpInputSchema.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    const issue = result.error!.issues[0]!;
    expect(issue.path).toEqual([path]);
    if (message) expect(issue.message).toBe(message);
  });
});

describe('signInInputSchema', () => {
  it('accepts any non-empty password, so older or shorter rules never lock anyone out', () => {
    expect(signInInputSchema.parse({ email: 'A@B.co', password: 'x' })).toEqual({
      email: 'a@b.co',
      password: 'x',
    });
  });

  it('rejects an empty password', () => {
    const result = signInInputSchema.safeParse({ email: 'a@b.co', password: '' });
    expect(result.error!.issues[0]!.message).toBe('Enter your password');
  });
});
