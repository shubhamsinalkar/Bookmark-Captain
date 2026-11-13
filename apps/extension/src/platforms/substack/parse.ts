import type { CapturedPost } from '../types';
import { SUBSTACK_ORIGIN } from './constants';

/**
 * Turns Substack's saved list (`/api/v1/reader/saved?filter=posts|notes`, checked on
 * 2026-11-12) into posts. Each item is `{ entity_key, type, context, … }`:
 *  - a post:  `p-123`, type `post`, with `post` and its `publication`;
 *  - a note:  `c-123`, type `comment`, with `comment` (Substack's notes are comments in a feed).
 * `context.timestamp` is when you saved it. Anything unrecognised is skipped, never thrown on.
 */

type Json = Record<string, unknown>;

const TITLE_MAX = 300;
const NOTE_TITLE_MAX = 120;
const TEXT_MAX = 20_000;
const POST_KEY = /^p-\d{1,20}$/;
const NOTE_KEY = /^c-\d{1,20}$/;
const HANDLE = /^[\w.-]{1,64}$/;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const https = (value: unknown): string | undefined => {
  const url = text(value);
  return url?.startsWith('https://') ? url : undefined;
};

const date = (value: unknown): string | undefined => {
  const raw = text(value);
  return raw && Number.isFinite(Date.parse(raw)) ? raw : undefined;
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

function savedAtOf(item: Json): string | undefined {
  return isRecord(item.context) ? date(item.context.timestamp) : undefined;
}

function postToPost(item: Json): CapturedPost | null {
  const post = item.post;
  const key = text(item.entity_key);
  if (!isRecord(post) || !key || !POST_KEY.test(key) || key !== `p-${String(post.id)}`) {
    return null;
  }
  const publication = isRecord(item.publication) ? item.publication : {};
  const url = https(post.canonical_url);
  const title = text(post.title);
  if (!url || !title) return null;

  const bylines = Array.isArray(post.publishedBylines) ? post.publishedBylines : [];
  const authors = bylines
    .map((byline) => (isRecord(byline) ? text(byline.name) : undefined))
    .filter((name): name is string => name !== undefined);
  const author = authors.length > 0 ? authors.join(', ') : text(publication.author_name);
  const summary = text(post.subtitle) ?? text(post.description) ?? text(post.truncated_body_text);
  const thumbnail = https(post.cover_image);
  const postedAt = date(post.post_date);
  const savedAt = savedAtOf(item);

  return {
    externalId: key,
    url,
    title: truncate(title, TITLE_MAX),
    ...(author && { author }),
    ...(summary && { text: truncate(summary, TEXT_MAX) }),
    ...(thumbnail && { thumbnailUrl: thumbnail }),
    ...(postedAt && { postedAt }),
    ...(savedAt && { savedAt }),
    metadata: compact({
      kind: 'post',
      publication: text(publication.name),
      publicationUrl: https(publication.base_url),
      words: number(post.wordcount),
      // `newsletter` for an article; other values (a podcast, a thread) are passed on as they are.
      postType: text(post.type),
    }),
  };
}

/** The first post and the first image a note carries (a shared article, a picture). */
function attachmentsOf(comment: Json): { post?: Json; image?: string } {
  const found: { post?: Json; image?: string } = {};
  const attachments = Array.isArray(comment.attachments) ? comment.attachments : [];
  for (const attachment of attachments) {
    if (!isRecord(attachment)) continue;
    if (attachment.type === 'post' && isRecord(attachment.post)) found.post ??= attachment.post;
    if (attachment.type === 'image') found.image ??= https(attachment.imageUrl);
  }
  return found;
}

function noteToPost(item: Json): CapturedPost | null {
  const comment = item.comment;
  const key = text(item.entity_key);
  if (!isRecord(comment) || !key || !NOTE_KEY.test(key) || key !== `c-${String(comment.id)}`) {
    return null;
  }
  const handle = text(comment.handle);
  if (!handle || !HANDLE.test(handle)) return null;

  const name = text(comment.name) ?? handle;
  const body = text(comment.body);
  const attached = attachmentsOf(comment);
  const attachedTitle = attached.post ? text(attached.post.title) : undefined;
  // Its first line is the title; the rest is the text (unless the line had to be cut short).
  const [firstLine = '', ...rest] = (body ?? '').split('\n');
  const shortFirstLine = Array.from(firstLine.trim()).length <= NOTE_TITLE_MAX;
  const title = firstLine.trim()
    ? truncate(firstLine.trim(), NOTE_TITLE_MAX)
    : attachedTitle
      ? truncate(attachedTitle, NOTE_TITLE_MAX)
      : `Note by ${name}`;
  const noteText = shortFirstLine ? text(rest.join('\n')) : body;
  const thumbnail =
    attached.image ?? (attached.post ? https(attached.post.cover_image) : undefined);
  const postedAt = date(comment.date);
  const savedAt = savedAtOf(item);

  return {
    externalId: key,
    url: `${SUBSTACK_ORIGIN}/@${encodeURIComponent(handle)}/note/${key}`,
    title,
    author: name,
    ...(noteText && { text: truncate(noteText, TEXT_MAX) }),
    ...(thumbnail && { thumbnailUrl: thumbnail }),
    ...(postedAt && { postedAt }),
    ...(savedAt && { savedAt }),
    metadata: compact({
      kind: 'note',
      handle,
      sharedPostTitle: attachedTitle,
      sharedPostUrl: attached.post ? https(attached.post.canonical_url) : undefined,
    }),
  };
}

/** One saved item → a post, or null if it isn't a post or a note we can read. */
export function itemToPost(item: unknown): CapturedPost | null {
  if (!isRecord(item)) return null;
  if (item.type === 'post') return postToPost(item);
  if (item.type === 'comment') return noteToPost(item);
  return null;
}

export interface SavedPage {
  /** Newest save first, as Substack lists them. */
  posts: CapturedPost[];
  /** Items Substack sent, readable or not: zero means the list itself is empty. */
  itemCount: number;
  /** Asks for the next page (`&cursor=`); null at the end of the list. */
  nextCursor: string | null;
}

/** A page of the saved list, or null when the answer isn't one (an error page, a change). */
export function parseSavedPage(json: unknown): SavedPage | null {
  if (!isRecord(json) || !Array.isArray(json.items)) return null;
  const posts = json.items.map(itemToPost).filter((post): post is CapturedPost => post !== null);
  return { posts, itemCount: json.items.length, nextCursor: text(json.nextCursor) ?? null };
}

export interface SaveRequest {
  /** Which saved list it changes. */
  list: 'posts' | 'notes';
  /** The item it names (`p-123` / `c-123`), when the request says. */
  key: string | null;
  action: 'save' | 'unsave';
}

/** A save or unsave request seen by the tap (`op` from `substackOperation`). */
export function parseSaveRequest(
  op: string,
  method: string,
  requestBody: string | undefined,
): SaveRequest | null {
  const action = method === 'POST' ? 'save' : method === 'DELETE' ? 'unsave' : null;
  if (!action) return null;
  if (op.startsWith('note:')) {
    const key = op.slice('note:'.length);
    return NOTE_KEY.test(key) ? { list: 'notes', key, action } : null;
  }
  if (op !== 'post') return null;
  let id: unknown;
  try {
    id = requestBody ? (JSON.parse(requestBody) as Json).post_id : undefined;
  } catch {
    // Not JSON: the request still says a post was saved or unsaved.
  }
  const key = typeof id === 'number' || typeof id === 'string' ? `p-${String(id)}` : null;
  return { list: 'posts', key: key && POST_KEY.test(key) ? key : null, action };
}
