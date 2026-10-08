import { z } from 'zod';
import { MAX_INGEST_BATCH } from './constants';
import { isPlatformId, type Platform } from './platforms';

/** A known platform id ("x") or the domain of any other site ("pinterest.com"). */
export const platformSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isPlatformId, { message: 'Expected a known platform or a domain' });

export const BOOKMARK_STATUSES = ['unread', 'opened', 'done', 'archived'] as const;
export const bookmarkStatusSchema = z.enum(BOOKMARK_STATUSES);
export type BookmarkStatus = z.infer<typeof bookmarkStatusSchema>;

/** AI enrichment lifecycle: waiting (or retrying), finished, or given up on. */
export const ENRICHMENT_STATUSES = ['pending', 'done', 'failed'] as const;
export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

/** What kind of thing a bookmark is, as judged by the AI. */
export const CONTENT_TYPES = [
  'article',
  'tutorial',
  'thread',
  'discussion',
  'video',
  'tool',
  'news',
  'opinion',
  'reference',
  'other',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** How long a bookmark stays worth reading: for years, for weeks, or only for days. */
export const SHELF_LIVES = ['evergreen', 'timely', 'ephemeral'] as const;
export type ShelfLife = (typeof SHELF_LIVES)[number];

/** Inbox views. `inbox` = unread or opened, and not snoozed. */
export const BOOKMARK_VIEWS = ['inbox', 'snoozed', 'done', 'archived', 'all'] as const;
export const bookmarkViewSchema = z.enum(BOOKMARK_VIEWS);
export type BookmarkView = z.infer<typeof bookmarkViewSchema>;

const MAX_METADATA_BYTES = 8 * 1024;

/** Dates travel as ISO-8601 strings (with offset) and become `Date`s after parsing. */
const isoDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();

/** One saved item, as sent by any capture source (extension, import, connectors). */
export const ingestItemSchema = z.object({
  platform: platformSchema,
  /** The platform's own id (e.g. tweet id). Defaults to the canonical URL when omitted. */
  externalId: z.string().trim().min(1).max(512).optional(),
  /** Validated and normalised server-side; invalid URLs are reported per item. */
  url: z.string().max(4096),
  title: optionalText(1000),
  author: optionalText(300),
  text: optionalText(20_000),
  thumbnailUrl: z
    .url({ protocol: /^https?$/ })
    .max(4096)
    .optional(),
  savedAt: isoDate.optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= MAX_METADATA_BYTES, {
      message: `metadata must be at most ${MAX_METADATA_BYTES} bytes`,
    })
    .optional(),
});
export type IngestItem = z.input<typeof ingestItemSchema>;

/**
 * Only the envelope is checked here. Items are validated one by one (`ingestItemSchema`) so a
 * single bad item — say, an over-long URL among 500 bookmarks — is reported in `rejected`
 * instead of failing the whole batch.
 */
export const ingestRequestSchema = z.object({
  items: z.array(z.unknown()).min(1).max(MAX_INGEST_BATCH),
});
export interface IngestRequest {
  items: IngestItem[];
}

export interface IngestResult {
  created: number;
  updated: number;
  rejected: { index: number; reason: string }[];
}

export const removeBySourceRequestSchema = z.object({
  platform: platformSchema,
  /** Either platform ids or URLs (for sources that key by URL, like browser bookmarks). */
  externalIds: z.array(z.string().min(1).max(4096)).max(MAX_INGEST_BATCH).default([]),
  urls: z.array(z.string().max(4096)).max(MAX_INGEST_BATCH).default([]),
});
export type RemoveBySourceRequest = z.input<typeof removeBySourceRequestSchema>;

export const createBookmarkRequestSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  title: optionalText(1000),
});
export type CreateBookmarkRequest = z.input<typeof createBookmarkRequestSchema>;

export const updateBookmarkRequestSchema = z
  .object({
    status: bookmarkStatusSchema.optional(),
    /** A future date to hide the item until then, or null to unsnooze. */
    snoozeUntil: isoDate.nullable().optional(),
  })
  .refine((value) => value.status !== undefined || value.snoozeUntil !== undefined, {
    message: 'Provide status and/or snoozeUntil',
  });
export type UpdateBookmarkRequest = z.input<typeof updateBookmarkRequestSchema>;

export const listBookmarksQuerySchema = z.object({
  view: bookmarkViewSchema.default('inbox'),
  platform: platformSchema.optional(),
  q: z.string().trim().max(200).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListBookmarksQuery = z.input<typeof listBookmarksQuerySchema>;

export interface Bookmark {
  id: string;
  platform: Platform;
  externalId: string;
  url: string;
  canonicalUrl: string;
  title: string | null;
  author: string | null;
  text: string | null;
  thumbnailUrl: string | null;
  metadata: Record<string, unknown>;
  status: BookmarkStatus;
  savedAt: string;
  snoozeUntil: string | null;
  createdAt: string;
  updatedAt: string;
  /** AI-written summary and labels. Null when AI enrichment is turned off on the server. */
  ai: BookmarkEnrichment | null;
}

/** Fields are null (topics empty) until `status` is `done`. */
export interface BookmarkEnrichment {
  status: EnrichmentStatus;
  /** A clear title, used for posts whose own "title" is just the start of their text. */
  headline: string | null;
  summary: string | null;
  /** Lowercase, e.g. ["postgres", "performance"]. */
  topics: string[];
  contentType: ContentType | null;
  /** Estimated minutes to read or watch; null when there is no way to tell. */
  readMinutes: number | null;
  shelfLife: ShelfLife | null;
}

/** A platform or site the user has bookmarks from (`GET /bookmarks/sources`). */
export interface BookmarkSource {
  platform: Platform;
  count: number;
}

export interface BookmarkPage {
  items: Bookmark[];
  nextCursor: string | null;
}

/** Events pushed to open web tabs over server-sent events. */
export type ServerEvent =
  | { type: 'bookmarks.changed'; reason: 'ingest' | 'update' | 'delete' | 'enrich' }
  | { type: 'ready' };
