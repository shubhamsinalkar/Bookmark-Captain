import type { CapturedPost } from '../types';
import { REDDIT_ORIGIN } from './constants';

/**
 * Turns Reddit's JSON listings (`/user/<name>/saved.json`, `/api/info.json`) into posts.
 * These are the same documented "thing" objects Reddit's API has served for years: a `kind`
 * (`t3` post, `t1` comment) and its `data`. Anything unrecognised is skipped, never thrown on.
 */

type Json = Record<string, unknown>;

const TITLE_MAX = 300;
const TEXT_MAX = 20_000;
/** `t3_abc123` (post) or `t1_abc123` (comment): Reddit's "fullname". */
const FULLNAME = /^t[13]_[a-z0-9]{1,16}$/;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const https = (value: unknown): string | undefined => {
  const url = text(value);
  return url?.startsWith('https://') ? url : undefined;
};

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

/** Listings are requested with `raw_json=1`; older responses still escape these. */
function decodeEntities(value: string): string {
  return value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function thumbnailOf(data: Json): string | undefined {
  const preview = data.preview;
  if (isRecord(preview) && Array.isArray(preview.images) && isRecord(preview.images[0])) {
    const source = preview.images[0].source;
    const url = isRecord(source) ? https(source.url) : undefined;
    if (url) return decodeEntities(url);
  }
  // `thumbnail` is "self", "default", "nsfw"… when there is no image.
  return https(data.thumbnail);
}

/** One listing child (`{ kind, data }`) → a post, or null if it isn't a post or comment. */
export function thingToPost(thing: unknown): CapturedPost | null {
  if (!isRecord(thing) || !isRecord(thing.data)) return null;
  const { kind, data } = thing;
  const id = text(data.name);
  const permalink = text(data.permalink);
  if ((kind !== 't3' && kind !== 't1') || !id || !FULLNAME.test(id) || !id.startsWith(kind)) {
    return null;
  }
  if (!permalink?.startsWith('/')) return null;

  const author = text(data.author);
  const created = number(data.created_utc);
  const postedAt = created === undefined ? undefined : new Date(created * 1000).toISOString();
  const subreddit = text(data.subreddit_name_prefixed);
  const shownAuthor = author && author !== '[deleted]' ? `u/${author}` : undefined;
  const base = {
    externalId: id,
    url: `${REDDIT_ORIGIN}${permalink}`,
    ...(shownAuthor && { author: shownAuthor }),
    ...(postedAt && { postedAt }),
  };

  if (kind === 't1') {
    const body = text(data.body)?.trim();
    const onPost = text(data.link_title);
    return {
      ...base,
      title: truncate(onPost ? `Comment on “${onPost}”` : 'Comment on Reddit', TITLE_MAX),
      ...(body && { text: truncate(body, TEXT_MAX) }),
      metadata: compact({
        kind: 'comment',
        subreddit,
        score: number(data.score),
        postUrl: https(data.link_permalink),
      }),
    };
  }

  const title = text(data.title)?.trim();
  const body = text(data.selftext)?.trim();
  const thumbnail = thumbnailOf(data);
  const link = https(data.url_overridden_by_dest);
  return {
    ...base,
    title: title ? truncate(title, TITLE_MAX) : subreddit ? `Post in ${subreddit}` : 'Reddit post',
    ...(body && { text: truncate(body, TEXT_MAX) }),
    ...(thumbnail && { thumbnailUrl: thumbnail }),
    metadata: compact({
      kind: 'post',
      subreddit,
      score: number(data.score),
      comments: number(data.num_comments),
      // The page a link post points at (not set for text posts).
      linkUrl: link && !link.startsWith(`${REDDIT_ORIGIN}/`) ? link : undefined,
      flair: text(data.link_flair_text),
      nsfw: data.over_18 === true ? true : undefined,
    }),
  };
}

function children(json: unknown): unknown[] {
  if (!isRecord(json) || json.kind !== 'Listing' || !isRecord(json.data)) return [];
  return Array.isArray(json.data.children) ? json.data.children : [];
}

export interface SavedPage {
  /** Newest save first, as Reddit lists them. */
  posts: CapturedPost[];
  /** The cursor for the next page; null at the end of the list. */
  after: string | null;
}

/** A page of `/user/<name>/saved.json`. */
export function parseSavedListing(json: unknown): SavedPage {
  const posts = children(json)
    .map(thingToPost)
    .filter((post): post is CapturedPost => post !== null);
  const after = isRecord(json) && isRecord(json.data) ? text(json.data.after) : undefined;
  return { posts, after: after ?? null };
}

/** `/api/me.json`: the signed-in user's name, or null when signed out. */
export function parseUsername(json: unknown): string | null {
  const name = isRecord(json) && isRecord(json.data) ? text(json.data.name) : undefined;
  return name && /^[\w-]{1,30}$/.test(name) ? name : null;
}

export interface SavedState {
  saved: CapturedPost[];
  unsaved: string[];
}

/** `/api/info.json?id=…`: which of these posts the signed-in user has saved right now. */
export function parseSavedState(json: unknown): SavedState {
  const state: SavedState = { saved: [], unsaved: [] };
  for (const thing of children(json)) {
    const post = thingToPost(thing);
    if (!post || !isRecord(thing) || !isRecord(thing.data)) continue;
    if (thing.data.saved === true) state.saved.push(post);
    else if (thing.data.saved === false) state.unsaved.push(post.externalId);
  }
  return state;
}

const MAX_IDS = 10;
/** A GraphQL operation whose name mentions saving, e.g. "UpdatePostSaveState". */
const SAVE_OPERATION = /"(?:operation|operationName)"\s*:\s*"[^"]*save[^"]*"/i;

/**
 * The posts a request might have saved or unsaved. `op` comes from `redditOperation`:
 * `save` for a save URL, `graphql` for GraphQL, where only mutations about saving count
 * (feed queries also ask for an `isSaved` field, which must not look like a save).
 */
export function saveRequestIds(op: string, requestBody: string | undefined): string[] {
  if (!requestBody) return [];
  const isSave =
    op === 'save' ||
    (op === 'graphql' &&
      (SAVE_OPERATION.test(requestBody) ||
        (/\bmutation\b/.test(requestBody) && /save/i.test(requestBody))));
  if (!isSave) return [];
  const ids = new Set<string>();
  for (const [id] of requestBody.matchAll(/\bt[13]_[a-z0-9]{1,16}\b/gi)) {
    ids.add(id.toLowerCase());
    if (ids.size >= MAX_IDS) break;
  }
  return [...ids];
}
