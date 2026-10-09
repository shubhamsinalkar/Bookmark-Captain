import { type BookmarkRow, bookmarks, type Database, type NewBookmarkRow } from '@bc/db';
import {
  type Bookmark,
  type BookmarkSource,
  type BookmarkView,
  type ContentType,
  type IngestResult,
  InvalidUrlError,
  type ingestItemSchema,
  type listBookmarksQuerySchema,
  normalizeUrl,
  type NormalizedUrl,
  type Platform,
  type ShelfLife,
  type updateBookmarkRequestSchema,
} from '@bc/shared';
import {
  and,
  arrayContains,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';
import type { EventBus } from '../../lib/event-bus';
import { HttpError } from '../../lib/http-error';

type IngestItem = z.output<typeof ingestItemSchema>;
type ListQuery = z.output<typeof listBookmarksQuerySchema>;
type BookmarkPatch = z.output<typeof updateBookmarkRequestSchema>;

const ACTIVE_STATUSES = ['unread', 'opened'] as const;

/**
 * `aiEnabled`: whether this server enriches bookmarks. When it doesn't, rows still waiting
 * for enrichment report `ai: null` instead of a "pending" that would never finish.
 */
export function toBookmarkDto(row: BookmarkRow, aiEnabled: boolean): Bookmark {
  const enriched = row.enrichmentStatus === 'done';
  return {
    id: row.id,
    platform: row.platform,
    externalId: row.externalId,
    url: row.url,
    canonicalUrl: row.canonicalUrl,
    title: row.title,
    author: row.author,
    text: row.text,
    thumbnailUrl: row.thumbnailUrl,
    metadata: row.metadata,
    status: row.status,
    savedAt: row.savedAt.toISOString(),
    snoozeUntil: row.snoozeUntil?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ai:
      enriched || aiEnabled
        ? {
            status: row.enrichmentStatus,
            headline: enriched ? row.headline : null,
            summary: enriched ? row.summary : null,
            topics: enriched ? row.topics : [],
            contentType: enriched ? (row.contentType as ContentType | null) : null,
            readMinutes: enriched ? row.readMinutes : null,
            shelfLife: enriched ? (row.shelfLife as ShelfLife | null) : null,
          }
        : null,
  };
}

// ── Pagination cursor: opaque base64url of the last row's sort key ─────────────
const cursorSchema = z.object({ s: z.iso.datetime(), i: z.uuid() });

function encodeCursor(row: BookmarkRow): string {
  return Buffer.from(JSON.stringify({ s: row.savedAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): z.infer<typeof cursorSchema> {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw HttpError.badRequest('Invalid pagination cursor');
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

/** Which bookmarks a view shows. Mirrored in apps/web/src/lib/bookmark-view.ts. */
export function viewCondition(view: BookmarkView, now: Date): SQL | undefined {
  switch (view) {
    case 'inbox':
      return and(
        inArray(bookmarks.status, ACTIVE_STATUSES),
        or(isNull(bookmarks.snoozeUntil), lte(bookmarks.snoozeUntil, now)),
      );
    case 'snoozed':
      return and(inArray(bookmarks.status, ACTIVE_STATUSES), gt(bookmarks.snoozeUntil, now));
    case 'done':
    case 'archived':
      return eq(bookmarks.status, view);
    case 'all':
      return undefined;
  }
}

/**
 * The word search behind `GET /bookmarks?q=`. Never null (a null column inside `or` can make
 * it so), so `not(...)` of it is safe.
 */
export function wordMatchCondition(q: string): SQL {
  const pattern = `%${escapeLikePattern(q)}%`;
  const matches = or(
    ilike(bookmarks.title, pattern),
    ilike(bookmarks.url, pattern),
    ilike(bookmarks.author, pattern),
    ilike(bookmarks.headline, pattern),
    ilike(bookmarks.summary, pattern),
    arrayContains(bookmarks.topics, [q.toLowerCase()]),
  );
  return sql`coalesce(${matches}, false)`;
}

function normalizeOrReject(url: string): NormalizedUrl {
  try {
    return normalizeUrl(url);
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      throw new HttpError(400, 'validation_error', 'Request validation failed', [
        { path: 'url', message: error.message },
      ]);
    }
    throw error;
  }
}

/** `excluded.<column>` inside ON CONFLICT DO UPDATE: the value we tried to insert. */
const excluded = (column: string) => sql.raw(`excluded.${column}`);

export function createBookmarkService(db: Database, events: EventBus) {
  const notify = (userId: string, reason: 'ingest' | 'update' | 'delete') =>
    events.publish(userId, { type: 'bookmarks.changed', reason });

  return {
    /**
     * Idempotent bulk upsert keyed on (user, platform, externalId). Re-sending an item updates
     * its content but never its status or savedAt, and rows whose content is unchanged are not
     * rewritten. Items with unusable URLs are reported individually instead of failing the batch.
     */
    async ingest(userId: string, items: IngestItem[]): Promise<IngestResult> {
      const rejected: IngestResult['rejected'] = [];
      // Keyed so a duplicate within one batch keeps its last occurrence; Postgres rejects an
      // upsert that touches the same row twice in a single statement.
      const rows = new Map<string, NewBookmarkRow>();
      const now = new Date();

      items.forEach((item, index) => {
        let normalized: NormalizedUrl;
        try {
          normalized = normalizeUrl(item.url);
        } catch (error) {
          if (!(error instanceof InvalidUrlError)) throw error;
          rejected.push({ index, reason: error.message });
          return;
        }
        const externalId = item.externalId ?? normalized.canonicalUrl;
        rows.set(`${item.platform}\u0000${externalId}`, {
          userId,
          platform: item.platform,
          externalId,
          url: normalized.url,
          canonicalUrl: normalized.canonicalUrl,
          title: item.title ?? null,
          author: item.author ?? null,
          text: item.text ?? null,
          thumbnailUrl: item.thumbnailUrl ?? null,
          metadata: item.metadata ?? {},
          savedAt: item.savedAt ?? now,
        });
      });

      if (rows.size === 0) return { created: 0, updated: 0, rejected };

      const nextTitle = sql`coalesce(${excluded('title')}, ${bookmarks.title})`;
      const nextAuthor = sql`coalesce(${excluded('author')}, ${bookmarks.author})`;
      const nextText = sql`coalesce(${excluded('text')}, ${bookmarks.text})`;
      const nextThumbnail = sql`coalesce(${excluded('thumbnail_url')}, ${bookmarks.thumbnailUrl})`;
      const nextMetadata = sql`${bookmarks.metadata} || ${excluded('metadata')}`;
      // New words mean a new summary; a moved folder or a refreshed thumbnail doesn't.
      const contentChanged = sql`(${bookmarks.url}, ${bookmarks.title}, ${bookmarks.text})
        is distinct from (${excluded('url')}, ${nextTitle}, ${nextText})`;
      const ifContentChanged = (value: SQL, otherwise: SQL) =>
        sql`case when ${contentChanged} then ${value} else ${otherwise} end`;

      const written = await db
        .insert(bookmarks)
        .values([...rows.values()])
        .onConflictDoUpdate({
          target: [bookmarks.userId, bookmarks.platform, bookmarks.externalId],
          set: {
            url: excluded('url'),
            canonicalUrl: excluded('canonical_url'),
            title: nextTitle,
            author: nextAuthor,
            text: nextText,
            thumbnailUrl: nextThumbnail,
            metadata: nextMetadata,
            // Re-queue for enrichment. Resetting the lease also voids any in-flight result.
            enrichmentStatus: ifContentChanged(
              sql`'pending'::enrichment_status`,
              sql`${bookmarks.enrichmentStatus}`,
            ),
            enrichmentAttempts: ifContentChanged(sql`0`, sql`${bookmarks.enrichmentAttempts}`),
            enrichmentRetryAt: ifContentChanged(sql`null`, sql`${bookmarks.enrichmentRetryAt}`),
            enrichmentError: ifContentChanged(sql`null`, sql`${bookmarks.enrichmentError}`),
            updatedAt: now,
          },
          setWhere: sql`(${bookmarks.url}, ${bookmarks.canonicalUrl}, ${bookmarks.title}, ${bookmarks.author}, ${bookmarks.text}, ${bookmarks.thumbnailUrl}, ${bookmarks.metadata})
            is distinct from (${excluded('url')}, ${excluded('canonical_url')}, ${nextTitle}, ${nextAuthor}, ${nextText}, ${nextThumbnail}, ${nextMetadata})`,
        })
        // xmax = 0 only for freshly inserted rows (a standard Postgres upsert idiom).
        .returning({ inserted: sql<boolean>`(xmax = 0)` });

      const created = written.filter((row) => row.inserted).length;
      const updated = written.length - created;
      if (written.length > 0) notify(userId, 'ingest');
      return { created, updated, rejected };
    },

    /**
     * Saves a single link by hand. If the same resource is already saved (from any platform),
     * returns the existing bookmark instead of creating a duplicate.
     */
    async create(
      userId: string,
      input: { url: string; title?: string | undefined },
    ): Promise<{ bookmark: BookmarkRow; created: boolean }> {
      const { url, canonicalUrl } = normalizeOrReject(input.url);
      const findExisting = async () => {
        const [row] = await db
          .select()
          .from(bookmarks)
          .where(and(eq(bookmarks.userId, userId), eq(bookmarks.canonicalUrl, canonicalUrl)))
          .limit(1);
        return row;
      };

      const existing = await findExisting();
      if (existing) return { bookmark: existing, created: false };

      const [inserted] = await db
        .insert(bookmarks)
        .values({
          userId,
          platform: 'manual',
          externalId: canonicalUrl,
          url,
          canonicalUrl,
          title: input.title ?? null,
          savedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        notify(userId, 'ingest');
        return { bookmark: inserted, created: true };
      }
      // Lost a race with a concurrent request for the same URL.
      return { bookmark: (await findExisting())!, created: false };
    },

    /** Every platform or site the user has bookmarks from, most bookmarks first. */
    async sources(userId: string): Promise<BookmarkSource[]> {
      const rows = await db
        .select({ platform: bookmarks.platform, count: sql<number>`count(*)::int` })
        .from(bookmarks)
        .where(eq(bookmarks.userId, userId))
        .groupBy(bookmarks.platform)
        .orderBy(desc(sql`count(*)`), bookmarks.platform);
      return rows;
    },

    async list(
      userId: string,
      query: ListQuery,
    ): Promise<{ rows: BookmarkRow[]; nextCursor: string | null }> {
      const conditions: (SQL | undefined)[] = [
        eq(bookmarks.userId, userId),
        viewCondition(query.view, new Date()),
      ];
      if (query.platform) conditions.push(eq(bookmarks.platform, query.platform));
      if (query.q) conditions.push(wordMatchCondition(query.q));

      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        conditions.push(
          sql`(${bookmarks.savedAt}, ${bookmarks.id}) < (${cursor.s}::timestamptz, ${cursor.i}::uuid)`,
        );
      }

      const rows = await db
        .select()
        .from(bookmarks)
        .where(and(...conditions))
        .orderBy(desc(bookmarks.savedAt), desc(bookmarks.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      return { rows: page, nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null };
    },

    async update(userId: string, id: string, patch: BookmarkPatch): Promise<BookmarkRow | null> {
      const [row] = await db
        .update(bookmarks)
        .set({
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.snoozeUntil !== undefined && { snoozeUntil: patch.snoozeUntil }),
        })
        .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
        .returning();
      if (row) notify(userId, 'update');
      return row ?? null;
    },

    async delete(userId: string, id: string): Promise<boolean> {
      const deleted = await db
        .delete(bookmarks)
        .where(and(eq(bookmarks.id, id), eq(bookmarks.userId, userId)))
        .returning({ id: bookmarks.id });
      if (deleted.length > 0) notify(userId, 'delete');
      return deleted.length > 0;
    },

    /** Mirrors deletions at the source (e.g. a bookmark removed in Chrome). Returns the count. */
    async removeBySource(
      userId: string,
      {
        platform,
        externalIds,
        urls,
      }: { platform: Platform; externalIds: string[]; urls: string[] },
    ): Promise<number> {
      const canonicalUrls = urls.flatMap((url) => {
        try {
          return [normalizeUrl(url).canonicalUrl];
        } catch {
          return [];
        }
      });
      const keys = [...new Set([...externalIds, ...canonicalUrls])];
      if (keys.length === 0) return 0;

      const deleted = await db
        .delete(bookmarks)
        .where(
          and(
            eq(bookmarks.userId, userId),
            eq(bookmarks.platform, platform),
            inArray(bookmarks.externalId, keys),
          ),
        )
        .returning({ id: bookmarks.id });
      if (deleted.length > 0) notify(userId, 'delete');
      return deleted.length;
    },
  };
}

export type BookmarkService = ReturnType<typeof createBookmarkService>;
