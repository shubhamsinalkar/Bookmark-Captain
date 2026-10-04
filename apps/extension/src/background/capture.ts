import type { IngestItem, Platform } from '@bc/shared';
import type { CapturedPost, CaptureVia } from '../platforms/types';

const MAX_ID_LENGTH = 512;
const MAX_URL_LENGTH = 4096;

const optionalString = (value: unknown) => value === undefined || typeof value === 'string';

/** Content scripts pass on data read from a third-party page: check its shape. */
export function isCapturedPost(value: unknown): value is CapturedPost {
  if (typeof value !== 'object' || value === null) return false;
  const post = value as Record<string, unknown>;
  return (
    typeof post.externalId === 'string' &&
    post.externalId.length > 0 &&
    post.externalId.length <= MAX_ID_LENGTH &&
    typeof post.url === 'string' &&
    post.url.startsWith('https://') &&
    post.url.length <= MAX_URL_LENGTH &&
    optionalString(post.title) &&
    optionalString(post.author) &&
    optionalString(post.text) &&
    optionalString(post.thumbnailUrl) &&
    optionalString(post.postedAt) &&
    (post.metadata === undefined ||
      (typeof post.metadata === 'object' &&
        post.metadata !== null &&
        !Array.isArray(post.metadata)))
  );
}

/** Above this many, removing more than half of what was synced looks like a misread page. */
const MAX_UNCHECKED_REMOVALS = 20;

/**
 * Posts sent before that are missing from a saved list read to its very end: they were
 * unsaved somewhere the extension couldn't see (another device, another tab). Removes
 * nothing when the list came back empty or would lose most of what was synced, since a
 * changed or half-loaded page is likelier than a cleared-out list.
 */
export function unlistedIds(known: readonly string[], listed: readonly string[]): string[] {
  if (listed.length === 0) return [];
  const present = new Set(listed);
  const missing = known.filter((id) => !present.has(id));
  if (missing.length > MAX_UNCHECKED_REMOVALS && missing.length > known.length / 2) return [];
  return missing;
}

export interface CaptureContext {
  /** Ids already sent from this platform. */
  known: ReadonlySet<string>;
  via: CaptureVia;
  /** Whether a full import of the saved list has finished at least once. */
  fullImportDone: boolean;
  now: number;
}

/**
 * Captured posts → ingest items. Platforms like X don't say *when* you saved a post, so
 * `savedAt` is inferred:
 *  - already sent before: omitted (the server keeps the original date anyway);
 *  - a live Save click: now;
 *  - read from the list after a full import has finished: now, because anything not seen
 *    before at the top of the list was saved since the last check;
 *  - read from the list before that (the first import): the post's own publish date, the
 *    best available stand-in for "saved a while ago".
 * New items in one batch are spaced 1 ms apart, so the inbox keeps the list's order.
 */
export function capturedToItems(
  platform: Platform,
  posts: CapturedPost[],
  { known, via, fullImportDone, now }: CaptureContext,
): { items: IngestItem[]; newIds: string[] } {
  const datedByPost = via !== 'live' && !fullImportDone;
  const newIds: string[] = [];
  const items = posts.map((post, index): IngestItem => {
    const { postedAt, ...fields } = post;
    if (known.has(post.externalId)) return { platform, ...fields };
    newIds.push(post.externalId);
    const savedAt =
      datedByPost && postedAt && Number.isFinite(Date.parse(postedAt))
        ? postedAt
        : new Date(now - index).toISOString();
    return { platform, ...fields, savedAt };
  });
  return { items, newIds };
}
