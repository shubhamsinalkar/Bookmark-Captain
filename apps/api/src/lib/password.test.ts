import { describe, expect, it } from 'vitest';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('correct horse batterY', stored)).toBe(false);
  });

  it('never stores the password itself, and salts every hash', async () => {
    const first = await hashPassword('same password');
    const second = await hashPassword('same password');
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(first).not.toContain('same password');
    expect(first).not.toBe(second);
  });

  it('treats differently composed but identical-looking characters as the same', async () => {
    const stored = await hashPassword('café'); // é as one character
    expect(await verifyPassword('café', stored)).toBe(true); // e + combining accent
  });

  it('rejects a stored value in an unknown format', async () => {
    expect(await verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('always fails the dummy check', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });
});
