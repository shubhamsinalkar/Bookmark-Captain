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
 * changed or half-loaded page is likelier than a cleared-out list; unless the site itself
 * said the list is empty (`listEmpty`), which removes everything, however much that is.
 */
export function unlistedIds(
  known: readonly string[],
  listed: readonly string[],
  { listEmpty = false }: { listEmpty?: boolean } = {},
): string[] {
  if (listed.length === 0) return listEmpty ? [...known] : [];
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
  /**
   * Every post on the page the posts were read from, in list order, when `posts` holds only
   * some of them (a tab reading a page again sends just the posts it hadn't seen).
   */
  pageIds?: readonly string[];
}

/**
 * Captured posts → ingest items. Platforms like X don't say *when* you saved a post, so
 * `savedAt` is inferred:
 *  - already sent before: omitted (the server keeps the original date anyway);
 *  - a live Save click: now;
 *  - listed above a post that was already sent: now. Saved lists put the newest saves
 *    first, so it was saved after that post, i.e. since the list was last read;
 *  - read from the list after a full import has finished: now, because anything not seen
 *    before at the top of the list was saved since the last check;
 *  - read from the list before that (the first import, or older saves an interrupted
 *    import never reached): the post's own publish date, the best available stand-in for
 *    "saved a while ago".
 * New items in one batch are spaced 1 ms apart, so the inbox keeps the list's order.
 */
export function capturedToItems(
  platform: Platform,
  posts: CapturedPost[],
  { known, via, fullImportDone, now, pageIds }: CaptureContext,
): { items: IngestItem[]; newIds: string[] } {
  const datedByPost = via !== 'live' && !fullImportDone;
  const order = pageIds ?? posts.map((post) => post.externalId);
  const firstKnown = order.findIndex((id) => known.has(id));
  const savedSinceLastRead = new Set(firstKnown > 0 ? order.slice(0, firstKnown) : []);
  const newIds: string[] = [];
  const items = posts.map((post, index): IngestItem => {
    const { postedAt, ...fields } = post;
    if (known.has(post.externalId)) return { platform, ...fields };
    newIds.push(post.externalId);
    const savedAt =
      datedByPost &&
      !savedSinceLastRead.has(post.externalId) &&
      postedAt &&
      Number.isFinite(Date.parse(postedAt))
        ? postedAt
        : new Date(now - index).toISOString();
    return { platform, ...fields, savedAt };
  });
  return { items, newIds };
}
