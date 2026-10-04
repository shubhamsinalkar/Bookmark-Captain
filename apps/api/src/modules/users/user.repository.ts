import { type Database, type UserRow, users } from '@bc/db';
import type { User } from '@bc/shared';
import { eq } from 'drizzle-orm';

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export function toUserDto(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatarUrl };
}

export function createUserRepository(db: Database) {
  return {
    /**
     * Finds the user by Google account id, falling back to email so an existing account
     * (e.g. created via dev login) is linked rather than duplicated. Google has verified
     * the email, which is what makes linking by email safe.
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
  };
}

export type UserRepository = ReturnType<typeof createUserRepository>;
