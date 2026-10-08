import { BOOKMARK_STATUSES, ENRICHMENT_STATUSES } from '@bc/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

/** Length of the vectors in `bookmark_embeddings`; the embedding model must produce this size. */
export const EMBEDDING_DIMENSIONS = 1024;

// Column names are converted to snake_case by the `casing` option (see client.ts and drizzle.config.ts).

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const bookmarkStatusEnum = pgEnum('bookmark_status', BOOKMARK_STATUSES);
export const enrichmentStatusEnum = pgEnum('enrichment_status', ENRICHMENT_STATUSES);

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  /** Always stored lowercased (see `emailSchema`), so a plain unique constraint is enough. */
  email: text().notNull().unique(),
  name: text(),
  avatarUrl: text(),
  /** Google's stable account id (`sub` claim). Null for users who never signed in with Google. */
  googleSub: text().unique('users_google_sub_unique'),
  ...timestamps,
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 hash of the session token. The raw token only ever lives in the user's cookie. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    userAgent: text(),
    ip: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId), index().on(t.expiresAt)],
);

/** Long-lived bearer tokens for non-browser clients such as the Chrome extension. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    /** SHA-256 hash of the token. */
    tokenHash: text().notNull().unique('api_tokens_token_hash_unique'),
    /** First characters of the token, for display only. */
    preview: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastUsedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * A known platform ("x", "instagram") or, for any other connected site, its domain
     * ("pinterest.com"). Validated by `platformSchema`; the check is a backstop.
     */
    platform: text().notNull(),
    /** The platform's id for the item; the canonical URL for URL-keyed sources. */
    externalId: text().notNull(),
    url: text().notNull(),
    canonicalUrl: text().notNull(),
    title: text(),
    author: text(),
    text: text(),
    thumbnailUrl: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: bookmarkStatusEnum().notNull().default('unread'),
    /** When the user saved it on the source platform. */
    savedAt: timestamp({ withTimezone: true }).notNull(),
    snoozeUntil: timestamp({ withTimezone: true }),

    // ── AI enrichment (apps/api/src/modules/ai). Reset to pending when the content changes.
    enrichmentStatus: enrichmentStatusEnum().notNull().default('pending'),
    enrichmentAttempts: integer().notNull().default(0),
    /**
     * Not picked up before this time: a lease while a worker holds the row, a backoff after a
     * failure. The worker only saves its result if the lease is still the one it took.
     */
    enrichmentRetryAt: timestamp({ withTimezone: true }),
    enrichmentError: text(),
    enrichedAt: timestamp({ withTimezone: true }),
    headline: text(),
    summary: text(),
    topics: text().array().notNull().default([]),
    /** One of `CONTENT_TYPES` / `SHELF_LIVES`; plain text so the taxonomy can grow freely. */
    contentType: text(),
    readMinutes: integer(),
    shelfLife: text(),

    ...timestamps,
  },
  (t) => [
    check('bookmarks_platform_format', sql`${t.platform} ~ '^[a-z0-9][a-z0-9.-]{0,252}$'`),
    uniqueIndex().on(t.userId, t.platform, t.externalId),
    // Inbox listing: newest first, keyset-paginated on (saved_at, id).
    index().on(t.userId, t.savedAt.desc(), t.id.desc()),
    // Cross-platform duplicate detection.
    index().on(t.userId, t.canonicalUrl),
    index()
      .on(t.userId, t.snoozeUntil)
      .where(sql`${t.snoozeUntil} is not null`),
    // Enrichment queue: pending rows, newest first.
    index('bookmarks_enrichment_queue_idx')
      .on(t.savedAt.desc())
      .where(sql`${t.enrichmentStatus} = 'pending'`),
  ],
);

/**
 * One vector per bookmark, for search by meaning. Kept out of `bookmarks` so ordinary listing
 * queries don't carry a kilobyte-sized column per row.
 */
export const bookmarkEmbeddings = pgTable(
  'bookmark_embeddings',
  {
    bookmarkId: uuid()
      .primaryKey()
      .references(() => bookmarks.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Vectors from different models aren't comparable; a model change re-embeds everything. */
    model: text().notNull(),
    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    /** The bookmark's `enrichedAt` this vector was computed from; older means stale. */
    sourceEnrichedAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.userId)],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type BookmarkRow = typeof bookmarks.$inferSelect;
export type NewBookmarkRow = typeof bookmarks.$inferInsert;
export type BookmarkEmbeddingRow = typeof bookmarkEmbeddings.$inferSelect;
