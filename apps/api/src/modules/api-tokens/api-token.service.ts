import { type ApiTokenRow, apiTokens, type Database, type UserRow, users } from '@bc/db';
import { API_TOKEN_PREFIX, type ApiTokenSummary, type CreatedApiToken } from '@bc/shared';
import { and, desc, eq } from 'drizzle-orm';
import { generateToken, sha256Hex } from '../../lib/tokens';

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 365 * DAY_MS;
const PREVIEW_LENGTH = API_TOKEN_PREFIX.length + 6;
/** `last_used_at` is informational; writing it at most every few minutes keeps auth cheap. */
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export function toApiTokenSummary(row: ApiTokenRow): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    preview: row.preview,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Long-lived bearer tokens. Like sessions, only a SHA-256 hash is stored. */
export function createApiTokenService(db: Database) {
  return {
    async create(userId: string, name: string): Promise<CreatedApiToken> {
      const token = `${API_TOKEN_PREFIX}${generateToken()}`;
      const [row] = await db
        .insert(apiTokens)
        .values({
          userId,
          name,
          tokenHash: sha256Hex(token),
          preview: token.slice(0, PREVIEW_LENGTH),
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        })
        .returning();
      return { token, apiToken: toApiTokenSummary(row!) };
    },

    async authenticate(token: string): Promise<{ user: UserRow; tokenId: string } | null> {
      if (!token.startsWith(API_TOKEN_PREFIX)) return null;

      const [row] = await db
        .select({
          user: users,
          tokenId: apiTokens.id,
          expiresAt: apiTokens.expiresAt,
          lastUsedAt: apiTokens.lastUsedAt,
        })
        .from(apiTokens)
        .innerJoin(users, eq(apiTokens.userId, users.id))
        .where(eq(apiTokens.tokenHash, sha256Hex(token)))
        .limit(1);
      if (!row || row.expiresAt.getTime() <= Date.now()) return null;

      const now = new Date();
      if (
        !row.lastUsedAt ||
        now.getTime() - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS
      ) {
        await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.tokenId));
      }
      return { user: row.user, tokenId: row.tokenId };
    },

    async list(userId: string): Promise<ApiTokenRow[]> {
      return db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.userId, userId))
        .orderBy(desc(apiTokens.createdAt));
    },

    /** Returns false when no such token belongs to the user. */
    async revoke(userId: string, id: string): Promise<boolean> {
      const deleted = await db
        .delete(apiTokens)
        .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
        .returning({ id: apiTokens.id });
      return deleted.length > 0;
    },
  };
}

export type ApiTokenService = ReturnType<typeof createApiTokenService>;
