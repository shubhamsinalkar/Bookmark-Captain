import type { CapturedPost } from '../types';
import { INSTAGRAM_ORIGIN } from './constants';

/**
 * Turns Instagram's web API responses (`/api/v1/feed/saved/posts/`, `/api/v1/media/<id>/info/`)
 * into posts. Defensive like the X parser: every field is optional and anything
 * unrecognised is skipped, never thrown on.
 *
 * Media ids are 19-digit numbers, beyond what a JSON number holds exactly, so the numeric
 * `pk` is never used: ids come from the string `id` ("<media id>_<owner id>") and posts are
 * keyed by their shortcode (`code`), which is also what their URL uses.
 */

type Json = Record<string, unknown>;

const TITLE_MAX = 280;
const TEXT_MAX = 20_000;
const SHORTCODE = /^[\w-]{5,40}$/;
const MEDIA_ID = /^\d{5,25}$/;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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

/** The largest image of a photo, a video's cover, or a carousel's first slide. */
function imageOf(media: Json): string | undefined {
  const own = list(isRecord(media.image_versions2) ? media.image_versions2.candidates : undefined);
  const first = isRecord(own[0]) ? text(own[0].url) : undefined;
  if (first?.startsWith('https://')) return first;
  const slide = list(media.carousel_media)[0];
  return isRecord(slide) ? imageOf(slide) : undefined;
}

function kindOf(media: Json): string | undefined {
  if (media.product_type === 'clips') return 'reel';
  switch (media.media_type) {
    case 1:
      return 'photo';
    case 2:
      return 'video';
    case 8:
      return 'carousel';
    default:
      return undefined;
  }
}

/** The numeric media id, from the string `id` ("<media id>_<owner id>"). */
export function mediaIdOf(media: unknown): string | null {
  const id = isRecord(media) ? text(media.id)?.split('_')[0] : undefined;
  return id && MEDIA_ID.test(id) ? id : null;
}

/** One media object → a post, or null if it isn't a readable post. */
export function mediaToPost(media: unknown): CapturedPost | null {
  if (!isRecord(media)) return null;
  const code = text(media.code);
  if (!code || !SHORTCODE.test(code)) return null;

  const user = isRecord(media.user) ? media.user : isRecord(media.owner) ? media.owner : {};
  const handle = text(user.username);
  const name = text(user.full_name);
  const caption = isRecord(media.caption) ? text(media.caption.text)?.trim() : undefined;
  const line = caption?.replace(/\s+/g, ' ').trim();
  const takenAt = number(media.taken_at);
  const postedAt = takenAt === undefined ? undefined : new Date(takenAt * 1000).toISOString();
  const kind = kindOf(media);
  const image = imageOf(media);
  const slides = list(media.carousel_media).length;

  return {
    externalId: code,
    url: `${INSTAGRAM_ORIGIN}/${kind === 'reel' ? 'reel' : 'p'}/${code}/`,
    title: line
      ? truncate(line, TITLE_MAX)
      : handle
        ? `${kind === 'reel' ? 'Reel' : 'Post'} by @${handle}`
        : 'Instagram post',
    ...(caption && { text: truncate(caption, TEXT_MAX) }),
    ...((name ?? handle) && {
      author: name && handle ? `${name} (@${handle})` : handle ? `@${handle}` : name,
    }),
    ...(image && { thumbnailUrl: image }),
    ...(postedAt && { postedAt }),
    metadata: compact({
      kind,
      handle,
      authorName: name,
      mediaId: mediaIdOf(media) ?? undefined,
      likes: number(media.like_count),
      comments: number(media.comment_count),
      mediaCount: slides > 0 ? slides : undefined,
    }),
  };
}

export interface SavedPage {
  /** Newest save first, as Instagram lists them. */
  posts: CapturedPost[];
  /** The cursor for the next page; null at the end of the list. */
  nextMaxId: string | null;
}

/** A page of `/api/v1/feed/saved/posts/`: `{ items: [{ media }], more_available, next_max_id }`. */
export function parseSavedFeed(json: unknown): SavedPage {
  if (!isRecord(json)) return { posts: [], nextMaxId: null };
  const posts = list(json.items)
    .map((item) => mediaToPost(isRecord(item) ? item.media : undefined))
    .filter((post): post is CapturedPost => post !== null);
  const next = text(json.next_max_id);
  return { posts, nextMaxId: json.more_available === true && next ? next : null };
}

/** Instagram answers API calls from a signed-out browser with `login_required`. */
export function isLoginRequired(status: number, json: unknown): boolean {
  return (
    status === 401 ||
    status === 403 ||
    (isRecord(json) && (json.message === 'login_required' || json.require_login === true))
  );
}

export interface SavedState {
  saved: CapturedPost[];
  unsaved: string[];
}

export type SaveAction = 'save' | 'unsave';

/**
 * `/api/v1/media/<id>/info/`: the post, saved or not. `action` is what the request just
 * did, when it said so plainly: that decides, because right after an unsave Instagram's
 * answer can still be "saved" (or leave `has_viewer_saved` out). Without it,
 * `has_viewer_saved` does.
 */
export function parseSavedState(json: unknown, action: SaveAction | null = null): SavedState {
  const state: SavedState = { saved: [], unsaved: [] };
  for (const media of list(isRecord(json) ? json.items : undefined)) {
    const post = mediaToPost(media);
    if (!post || !isRecord(media)) continue;
    const saved = action ? action === 'save' : media.has_viewer_saved;
    if (saved === true) state.saved.push(post);
    else if (saved === false) state.unsaved.push(post.externalId);
  }
  return state;
}

/** A save request Instagram turned down: GraphQL `errors`, or the older API's `"fail"`. */
export function isFailedSave(json: unknown): boolean {
  if (!isRecord(json)) return false;
  return (Array.isArray(json.errors) && json.errors.length > 0) || json.status === 'fail';
}

const MAX_IDS = 10;

/** String ids under `media_id` keys anywhere in a mutation's variables (`input.media_id`). */
function namedMediaIds(variables: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(variables);
  } catch {
    return [];
  }
  const ids: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 10 || typeof value !== 'object' || value === null) return;
    for (const [key, child] of Object.entries(value as Json)) {
      // Numbers are skipped: a media id is too big for a JSON number to hold exactly.
      const id = /^media_?id$/i.test(key) ? mediaIdOf({ id: child }) : null;
      if (id) ids.push(id);
      else visit(child, depth + 1);
    }
  };
  visit(parsed, 0);
  return ids;
}

/** `usePolarisSaveMediaSaveMutation` / `…UnsaveMutation`; anything else isn't plain. */
function actionOf(name: string): SaveAction | null {
  if (/unsave/i.test(name)) return 'unsave';
  return /save(?:mutation)?$/i.test(name) ? 'save' : null;
}

export interface SaveRequest {
  /** The media the request saved or unsaved. */
  ids: string[];
  /** What it did, when it says so plainly; null: ask Instagram (`has_viewer_saved`). */
  action: SaveAction | null;
}

/**
 * The media a request might have saved or unsaved. `op` comes from `instagramOperation`:
 * `save:<id>` / `unsave:<id>` carry the id from the address; for `graphql`, only requests
 * named after saving count (`fb_api_req_friendly_name=usePolarisSaveMediaSaveMutation`),
 * and the ids are read from their variables: the `media_id`, since they also carry your own
 * account id (`actor_id`); failing that, every long number in them, and then which way it
 * went is left to Instagram.
 */
export function saveRequest(op: string, requestBody: string | undefined): SaveRequest | null {
  const [, verb, id] = /^(save|unsave):(\d{5,25})$/.exec(op) ?? [];
  if (verb && id) return { ids: [id], action: verb === 'unsave' ? 'unsave' : 'save' };
  if (op !== 'graphql' || !requestBody) return null;
  const fields = new URLSearchParams(requestBody);
  const name = fields.get('fb_api_req_friendly_name') ?? '';
  if (!/save/i.test(name)) return null;
  const variables = fields.get('variables') ?? '';
  const named = [...new Set(namedMediaIds(variables))];
  if (named.length > 0) return { ids: named.slice(0, MAX_IDS), action: actionOf(name) };
  const found = new Set<string>();
  for (const [number] of variables.matchAll(/\d{15,25}/g)) found.add(number);
  return found.size > 0 ? { ids: [...found].slice(0, MAX_IDS), action: null } : null;
}
