import { type Database, type UserRow, sessions, users } from '@bc/db';
import { eq } from 'drizzle-orm';
import { generateToken, sha256Hex } from '../../lib/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SessionMeta {
  userAgent?: string | undefined;
  ip?: string | undefined;
}

export interface ValidatedSession {
  user: UserRow;
  expiresAt: Date;
  /** True when the expiry was just extended, meaning the cookie must be re-issued. */
  renewed: boolean;
}

/**
 * Opaque server-side sessions. The client holds a random token; the database stores only
 * its SHA-256 hash, so a leaked database cannot be used to hijack sessions.
 */
export function createSessionService(db: Database, ttlDays: number) {
  const ttlMs = ttlDays * DAY_MS;

  return {
    async create(userId: string, meta: SessionMeta = {}) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + ttlMs);
      await db.insert(sessions).values({
        id: sha256Hex(token),
        userId,
        expiresAt,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
        ip: meta.ip ?? null,
      });
      return { token, expiresAt };
    },

    async validate(token: string): Promise<ValidatedSession | null> {
      const id = sha256Hex(token);
      const [row] = await db
        .select({ user: users, expiresAt: sessions.expiresAt })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.id, id))
        .limit(1);
      if (!row) return null;

      const now = Date.now();
      if (row.expiresAt.getTime() <= now) {
        await db.delete(sessions).where(eq(sessions.id, id));
        return null;
      }

      // Sliding expiry, renewed only once less than half the lifetime remains,
      // so active users stay signed in without a database write on every request.
      if (row.expiresAt.getTime() - now < ttlMs / 2) {
        const expiresAt = new Date(now + ttlMs);
        await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
        return { user: row.user, expiresAt, renewed: true };
      }

      return { user: row.user, expiresAt: row.expiresAt, renewed: false };
    },

    async revoke(token: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
