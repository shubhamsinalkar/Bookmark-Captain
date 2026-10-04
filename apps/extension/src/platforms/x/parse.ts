import type { CapturedPost } from '../types';

/**
 * Turns X's web GraphQL responses into posts. Defensive by design: X changes field
 * locations regularly (e.g. `screen_name` moved from `user.legacy` to `user.core` in 2025),
 * so every field has a fallback and anything unrecognised is skipped, never thrown on.
 */

type Json = Record<string, unknown>;

const TITLE_MAX = 280;
const TEXT_MAX = 20_000;
/** Tweet ids are snowflakes: milliseconds since this epoch, shifted left by 22 bits. */
const SNOWFLAKE_EPOCH_MS = 1_288_834_974_657n;
const MAX_DEPTH = 64;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function get(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** The tweet inside visibility wrappers; null for tombstones and unavailable posts. */
function unwrapTweet(value: unknown): Json | null {
  if (!isRecord(value)) return null;
  if (value.__typename === 'TweetWithVisibilityResults') return unwrapTweet(value.tweet);
  const id = value.rest_id;
  if (typeof id !== 'string' || !/^\d{1,25}$/.test(id) || !isRecord(value.legacy)) return null;
  if (!isRecord(get(value, 'core', 'user_results'))) return null;
  return value;
}

/** X escapes exactly these three characters in `full_text`. */
function decodeEntities(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function mediaOf(legacy: Json): Json[] {
  const extended = list(get(legacy, 'extended_entities', 'media'));
  return (extended.length > 0 ? extended : list(get(legacy, 'entities', 'media'))).filter(isRecord);
}

function postText(tweet: Json, legacy: Json): string {
  // Long posts ("note tweets") keep their full text separately; `full_text` is truncated.
  const note = get(tweet, 'note_tweet', 'note_tweet_results', 'result');
  let body: string;
  let links: unknown;
  if (isRecord(note) && typeof note.text === 'string') {
    body = note.text;
    links = get(note, 'entity_set', 'urls');
  } else {
    body = text(legacy.full_text) ?? '';
    // Replies start with "@someone @other "; display_text_range[0] skips them. Mentions are
    // ASCII, so code-point and UTF-16 offsets agree here.
    const start = list(legacy.display_text_range)[0];
    if (typeof start === 'number' && start > 0) body = Array.from(body).slice(start).join('');
    links = get(legacy, 'entities', 'urls');
  }

  // t.co short links → the real destination; media links are dropped (the media is metadata).
  for (const link of list(links)) {
    const short = text(get(link, 'url'));
    const expanded = text(get(link, 'expanded_url'));
    if (short && expanded) body = body.replaceAll(short, expanded);
  }
  for (const media of mediaOf(legacy)) {
    const short = text(media.url);
    if (short) body = body.replaceAll(short, '');
  }
  return decodeEntities(body).trim();
}

function postedAt(id: string, createdAt: unknown): string | undefined {
  const parsed = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN;
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  try {
    return new Date(Number((BigInt(id) >> 22n) + SNOWFLAKE_EPOCH_MS)).toISOString();
  } catch {
    return undefined;
  }
}

function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max
    ? value
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** Drops undefined values so metadata stays small and stable between syncs. */
function compact(values: Json): Json {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

/** One tweet object → a post, or null if it isn't a readable tweet. */
export function tweetToPost(value: unknown): CapturedPost | null {
  const tweet = unwrapTweet(value);
  if (!tweet) return null;
  const id = tweet.rest_id as string;
  const legacy = tweet.legacy as Json;
  const user = get(tweet, 'core', 'user_results', 'result');
  const handle = text(get(user, 'core', 'screen_name')) ?? text(get(user, 'legacy', 'screen_name'));
  const name = text(get(user, 'core', 'name')) ?? text(get(user, 'legacy', 'name'));
  const avatarUrl =
    text(get(user, 'avatar', 'image_url')) ?? text(get(user, 'legacy', 'profile_image_url_https'));

  const body = postText(tweet, legacy);
  const line = body.replace(/\s+/g, ' ').trim();
  const media = mediaOf(legacy);
  const thumbnail = text(media[0]?.media_url_https);
  const posted = postedAt(id, legacy.created_at);
  const quotedId = text(get(tweet, 'quoted_status_result', 'result', 'rest_id'));

  return {
    externalId: id,
    url: handle ? `https://x.com/${handle}/status/${id}` : `https://x.com/i/status/${id}`,
    title: line ? truncate(line, TITLE_MAX) : handle ? `Post by @${handle}` : 'Post on X',
    ...(body && { text: truncate(body, TEXT_MAX) }),
    ...((name ?? handle) && {
      author: name && handle ? `${name} (@${handle})` : handle ? `@${handle}` : name,
    }),
    ...(thumbnail?.startsWith('https://') && { thumbnailUrl: thumbnail }),
    ...(posted && { postedAt: posted }),
    metadata: compact({
      handle,
      authorName: name,
      avatarUrl: avatarUrl?.startsWith('https://') ? avatarUrl : undefined,
      postedAt: posted,
      mediaCount: media.length > 0 ? media.length : undefined,
      quotedPostId: quotedId,
    }),
  };
}

/** Calls `visit` on every object in a JSON tree (depth-limited). */
function walk(value: unknown, visit: (node: Json) => void, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, depth + 1);
  } else if (isRecord(value)) {
    visit(value);
    for (const child of Object.values(value)) walk(child, visit, depth + 1);
  }
}

/**
 * Every tweet anywhere in a response, including quoted ones. Used to remember tweets the
 * user has seen, so a later "Bookmark" click can be saved with its full content.
 */
export function extractTweets(json: unknown): CapturedPost[] {
  const posts = new Map<string, CapturedPost>();
  walk(json, (node) => {
    const post = tweetToPost(node);
    if (post && !posts.has(post.externalId)) posts.set(post.externalId, post);
  });
  return [...posts.values()];
}

export interface BookmarksPage {
  /** The bookmarked posts on this page, newest bookmark first. */
  posts: CapturedPost[];
  /** False once X returns a page without timeline items (the end of the list). */
  hasMore: boolean;
}

/**
 * A page of the Bookmarks timeline. Only timeline items count: a tweet quoted inside a
 * bookmarked tweet was not itself bookmarked.
 */
export function parseBookmarksPage(json: unknown): BookmarksPage {
  const posts = new Map<string, CapturedPost>();
  let items = 0;
  let hasBottomCursor = false;

  walk(json, (node) => {
    if (node.cursorType === 'Bottom') hasBottomCursor = true;
    const content = node.itemContent;
    if (!isRecord(content)) return;
    if (content.itemType !== 'TimelineTweet' && content.__typename !== 'TimelineTweet') return;
    if (content.promotedMetadata) return; // Ads.
    items += 1; // Counted even when unreadable (deleted posts still mean "more pages").
    const post = tweetToPost(get(content, 'tweet_results', 'result'));
    if (post && !posts.has(post.externalId)) posts.set(post.externalId, post);
  });

  return { posts: [...posts.values()], hasMore: items > 0 && hasBottomCursor };
}

/** The tweet id in a CreateBookmark / DeleteBookmark request body. */
export function bookmarkMutationTweetId(requestBody: string | undefined): string | null {
  if (!requestBody) return null;
  try {
    const id = get(JSON.parse(requestBody), 'variables', 'tweet_id');
    return typeof id === 'string' && /^\d{1,25}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Mutations answer 200 with an `errors` array when they fail. */
export function isSuccessfulResponse(status: number, json: unknown): boolean {
  return status >= 200 && status < 300 && !(isRecord(json) && list(json.errors).length > 0);
}

/** A placeholder for a bookmarked tweet we haven't seen the content of yet. */
export function minimalPost(id: string): CapturedPost {
  const posted = postedAt(id, undefined);
  return {
    externalId: id,
    url: `https://x.com/i/status/${id}`,
    title: 'Post on X',
    ...(posted && { postedAt: posted }),
  };
}
