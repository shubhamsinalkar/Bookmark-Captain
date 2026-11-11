import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt (built into Node, so no native dependency).
 *
 * Stored format: `scrypt$<N>$<r>$<p>$<salt>$<hash>` (salt and hash in base64url). The cost
 * parameters travel with each hash, so they can be raised later without breaking old ones.
 * N = 2^15 takes roughly 50–100 ms and 32 MB per hash: slow for anyone guessing, fine for a login.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function deriveKey(password: string, salt: Buffer, params: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must exceed 128 * N * r bytes, or scrypt refuses to run.
    const options = { ...params, maxmem: 128 * params.N! * params.r! * 2 };
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'base64url');
  const key = await deriveKey(password, Buffer.from(salt, 'base64url'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Does the same work as a real check and always fails. Used when the email has no password,
 * so the response time doesn't reveal which emails have accounts.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
  return false;
}
