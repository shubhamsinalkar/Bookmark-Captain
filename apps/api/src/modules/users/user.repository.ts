import { type Database, sessions, type UserRow, users } from '@bc/db';
import type { User } from '@bc/shared';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export function toUserDto(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    hasPassword: row.passwordHash !== null,
  };
}

export function createUserRepository(db: Database) {
  return {
    /**
     * Finds the user by Google account id, falling back to email so an existing account
     * (e.g. created with a password) is linked rather than duplicated. Google has verified
     * the email, which is what makes linking by email safe.
     *
     * Password sign-up does not verify the email, so someone could create an account with
     * another person's address before that person ever signs in. When Google proves who owns
     * the address, the unverified password is removed and its sessions are ended, so such a
     * squatter loses access. The real owner can keep using Google.
     */
    async upsertFromGoogle(profile: GoogleProfile): Promise<UserRow> {
      const details = {
        email: profile.email,
        ...(profile.name !== null && { name: profile.name }),
        ...(profile.picture !== null && { avatarUrl: profile.picture }),
      };

      return db.transaction(async (tx) => {
        const [existing] = await tx
          .update(users)
          .set(details)
          .where(eq(users.googleSub, profile.sub))
          .returning();
        if (existing) return existing;

        const [unverified] = await tx
          .update(users)
          .set({ passwordHash: null })
          .where(
            and(
              eq(users.email, profile.email),
              isNull(users.googleSub),
              isNotNull(users.passwordHash),
            ),
          )
          .returning({ id: users.id });
        if (unverified) await tx.delete(sessions).where(eq(sessions.userId, unverified.id));

        const [linkedOrCreated] = await tx
          .insert(users)
          .values({ ...details, googleSub: profile.sub })
          .onConflictDoUpdate({ target: users.email, set: { ...details, googleSub: profile.sub } })
          .returning();
        return linkedOrCreated!;
      });
    },

    async findOrCreateByEmail(input: {
      email: string;
      name?: string | undefined;
    }): Promise<UserRow> {
      const [row] = await db
        .insert(users)
        .values({ email: input.email, name: input.name ?? null })
        // A no-op update so RETURNING yields the existing row on conflict.
        .onConflictDoUpdate({ target: users.email, set: { email: input.email } })
        .returning();
      return row!;
    },

    async setPasswordHash(userId: string, passwordHash: string): Promise<UserRow> {
      const [row] = await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, userId))
        .returning();
      return row!;
    },

    async findByEmail(email: string): Promise<UserRow | undefined> {
      const [row] = await db.select().from(users).where(eq(users.email, email));
      return row;
    },

    /**
     * Creates a password account. Returns undefined when the email is already taken: the
     * unique constraint decides, so two sign-ups racing for one address can't both win.
     */
    async createWithPassword(input: {
      email: string;
      passwordHash: string;
      name?: string | undefined;
    }): Promise<UserRow | undefined> {
      const [row] = await db
        .insert(users)
        .values({ email: input.email, name: input.name ?? null, passwordHash: input.passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning();
      return row;
    },
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
