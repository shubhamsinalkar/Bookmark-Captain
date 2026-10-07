import type { CapturedPost } from '../types';
import { WATCH_LATER_ID, YOUTUBE_ORIGIN } from './constants';

/**
 * Turns YouTube's InnerTube data into posts. YouTube describes the same video in several
 * shapes: `lockupViewModel` (playlists and feeds since 2025), and the older
 * `playlistVideoRenderer` / `videoRenderer`. All are read, every field is optional, and
 * anything unrecognised is skipped, never thrown on.
 */

type Json = Record<string, unknown>;

const TITLE_MAX = 300;
const MAX_DEPTH = 80;
const VIDEO_ID = /^[\w-]{11}$/;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

function get(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === 'number') current = current[key];
    else if (isRecord(current) && typeof key === 'string') current = current[key];
    else return undefined;
  }
  return current;
}

/** `{ simpleText }` or `{ runs: [{ text }] }`, YouTube's two ways of sending text. */
function textOf(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return (
    text(value.simpleText) ??
    text(value.content) ??
    text(
      list(value.runs)
        .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
        .join(''),
    )
  );
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

/** The first string under `key` anywhere inside `value`. */
function findString(value: unknown, key: string): string | undefined {
  let found: string | undefined;
  walk(value, (node) => {
    found ??= text(node[key]);
  });
  return found;
}

const DURATION = /^\d{1,2}(?::\d{2}){1,2}$/;

/** A video as a post. The thumbnail address is YouTube's stable one, not a signed copy. */
export function videoPost(
  videoId: string,
  fields: { title?: string; channel?: string; duration?: string } = {},
): CapturedPost {
  const { title, channel, duration } = fields;
  return {
    externalId: videoId,
    url: `${YOUTUBE_ORIGIN}/watch?v=${videoId}`,
    title: title ? truncate(title, TITLE_MAX) : 'YouTube video',
    ...(channel && { author: channel }),
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    metadata: compact({
      channel,
      duration: duration && DURATION.test(duration) ? duration : undefined,
    }),
  };
}

export interface ListedVideo {
  post: CapturedPost;
  /** The video's entry in this playlist; Watch later's own Remove button sends only this. */
  setVideoId?: string;
}

function lockupVideo(lockup: unknown): ListedVideo | null {
  if (!isRecord(lockup) || lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const id = text(lockup.contentId);
  if (!id || !VIDEO_ID.test(id)) return null;
  const meta = get(lockup, 'metadata', 'lockupMetadataViewModel');
  const channel = textOf(
    get(
      meta,
      'metadata',
      'contentMetadataViewModel',
      'metadataRows',
      0,
      'metadataParts',
      0,
      'text',
    ),
  );
  let duration: string | undefined;
  walk(get(lockup, 'contentImage'), (node) => {
    const badge = text(get(node, 'thumbnailBadgeViewModel', 'text'));
    if (!duration && badge && DURATION.test(badge)) duration = badge;
  });
  const setVideoId = findString(lockup, 'setVideoId') ?? findString(lockup, 'playlistSetVideoId');
  return {
    post: videoPost(id, { title: textOf(get(meta, 'title')), channel, duration }),
    ...(setVideoId && { setVideoId }),
  };
}

function rendererVideo(renderer: unknown): ListedVideo | null {
  if (!isRecord(renderer) || renderer.isPlayable === false) return null; // Deleted/private.
  const id = text(renderer.videoId);
  if (!id || !VIDEO_ID.test(id)) return null;
  // The playlist panel beside a video playing from Watch later names it `playlistSetVideoId`.
  const setVideoId = text(renderer.setVideoId) ?? text(renderer.playlistSetVideoId);
  return {
    post: videoPost(id, {
      title: textOf(renderer.title),
      channel: textOf(renderer.shortBylineText) ?? textOf(renderer.ownerText),
      duration: textOf(renderer.lengthText),
    }),
    ...(setVideoId && { setVideoId }),
  };
}

/** Every video described anywhere in a response, in order. */
export function extractVideos(json: unknown): ListedVideo[] {
  const videos = new Map<string, ListedVideo>();
  walk(json, (node) => {
    const video =
      lockupVideo(node.lockupViewModel) ??
      rendererVideo(node.playlistVideoRenderer) ??
      rendererVideo(node.videoRenderer) ??
      rendererVideo(node.compactVideoRenderer) ??
      rendererVideo(node.playlistPanelVideoRenderer);
    if (video && !videos.has(video.post.externalId)) videos.set(video.post.externalId, video);
  });
  return [...videos.values()];
}

export interface WatchLaterPage {
  videos: ListedVideo[];
  /** False once a page has no "load more" item (the end of the list). */
  hasMore: boolean;
  /** YouTube itself said Watch later has no videos (not merely that none were read). */
  empty: boolean;
}

/**
 * An empty Watch later comes with its playlist header and, where the list would be, a
 * section holding only a message ("No videos in this playlist yet"). Both are checked by
 * shape, not by the (translated) text, and a page that doesn't match is never called empty.
 */
function saysEmpty(json: unknown): boolean {
  if (findString(get(json, 'header'), 'playlistId') !== WATCH_LATER_ID) return false;
  let messageOnly = false;
  walk(json, (node) => {
    const contents = list(get(node, 'itemSectionRenderer', 'contents'));
    if (contents.length > 0 && contents.every((item) => isRecord(get(item, 'messageRenderer')))) {
      messageOnly = true;
    }
  });
  return messageOnly;
}

/** A page of the Watch later list: its first page or a continuation. */
export function parseWatchLaterPage(json: unknown): WatchLaterPage {
  let hasMore = false;
  walk(json, (node) => {
    if ('continuationItemRenderer' in node || 'continuationItemViewModel' in node) hasMore = true;
  });
  const videos = extractVideos(json);
  return { videos, hasMore, empty: videos.length === 0 && !hasMore && saysEmpty(json) };
}

/** The browse id YouTube requests for the Watch later page ("VL" + playlist id). */
const WATCH_LATER_BROWSE_ID = `VL${WATCH_LATER_ID}`;

/**
 * What a `browse` request asked for: a page (`{ browseId }`), or more of the page already
 * showing (`{ continuation }`). YouTube switches pages without reloading and loads the new
 * page before the address changes, so this, not the address, says which page data is for.
 */
export function browseRequestTarget(
  requestBody: string | undefined,
): 'watch-later' | 'other-page' | 'continuation' | null {
  if (!requestBody) return null;
  let body: unknown;
  try {
    body = JSON.parse(requestBody);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  if (typeof body.browseId === 'string') {
    return body.browseId === WATCH_LATER_BROWSE_ID ? 'watch-later' : 'other-page';
  }
  return typeof body.continuation === 'string' ? 'continuation' : null;
}

export interface WatchLaterEdit {
  added: string[];
  removed: string[];
  /** Removals by playlist entry (Watch later's own Remove button). */
  removedEntries: string[];
  /** A removal in a shape this parser doesn't know: which videos left can't be told. */
  unknownRemoval: boolean;
}

/**
 * An `edit_playlist` request, if it changed Watch later:
 * `{ playlistId: "WL", actions: [{ action: "ACTION_ADD_VIDEO", addedVideoId }] }`.
 */
export function parseWatchLaterEdit(requestBody: string | undefined): WatchLaterEdit | null {
  if (!requestBody) return null;
  let body: unknown;
  try {
    body = JSON.parse(requestBody);
  } catch {
    return null;
  }
  if (!isRecord(body) || body.playlistId !== WATCH_LATER_ID) return null;
  const edit: WatchLaterEdit = {
    added: [],
    removed: [],
    removedEntries: [],
    unknownRemoval: false,
  };
  for (const action of list(body.actions)) {
    if (!isRecord(action)) continue;
    const added = text(action.addedVideoId);
    const removed = text(action.removedVideoId);
    const entry = text(action.setVideoId);
    if (action.action === 'ACTION_ADD_VIDEO' && added && VIDEO_ID.test(added)) {
      edit.added.push(added);
    } else if (
      action.action === 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' &&
      removed &&
      VIDEO_ID.test(removed)
    ) {
      edit.removed.push(removed);
    } else if (action.action === 'ACTION_REMOVE_VIDEO' && entry) {
      edit.removedEntries.push(entry);
    } else if (typeof action.action === 'string' && action.action.includes('REMOVE')) {
      edit.unknownRemoval = true;
    }
  }
  const changes = edit.added.length + edit.removed.length + edit.removedEntries.length;
  return changes > 0 || edit.unknownRemoval ? edit : null;
}

/** InnerTube answers a failed edit with a 200 and another status. */
export function isSuccessfulEdit(status: number, json: unknown): boolean {
  if (status < 200 || status >= 300) return false;
  return !isRecord(json) || json.status === undefined || json.status === 'STATUS_SUCCEEDED';
}

/** `/oembed?url=…&format=json`: a video's title and channel, when the page didn't show it. */
export function parseOembed(videoId: string, json: unknown): CapturedPost {
  return videoPost(videoId, {
    title: isRecord(json) ? text(json.title) : undefined,
    channel: isRecord(json) ? text(json.author_name) : undefined,
  });
}
