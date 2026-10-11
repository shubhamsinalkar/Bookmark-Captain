import type { CapturedPost } from '../types';
import { LINKEDIN_ORIGIN, POST_URN, SAVED_POSTS_INTENT } from './constants';

/**
 * Turns LinkedIn's Voyager API responses into posts. LinkedIn changes the exact shape of
 * these often, so nothing here depends on where an object sits: the responses are walked
 * and posts are recognised by their own fields. Defensive like the other parsers: every
 * field is optional and anything unrecognised is skipped, never thrown on.
 *
 * Responses come "normalized" (`{ data, included }`): the list in `data` refers to entities
 * in `included` by URN, and `included` is in no particular order, so the list order is
 * taken from those references.
 *
 *  - saved list: `EntityResultViewModel`s (`title` = author, `summary` = the post's text,
 *    `entityEmbeddedObject` = its image or article);
 *  - feed and post pages: `Update`s (`actor`, `commentary`, `content`).
 *
 * Posts are keyed by their URN (`urn:li:activity:<id>`), which is also what their address uses.
 */

type Json = Record<string, unknown>;

const TITLE_MAX = 280;
const TEXT_MAX = 20_000;
/** Responses can be large: stop walking one after this many values. */
const MAX_NODES = 200_000;
const MAX_DEPTH = 40;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** `{ text: "…" }` (LinkedIn's TextViewModel), or a plain string. */
function textOf(value: unknown): string | undefined {
  return isRecord(value) ? text(value.text) : text(value);
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

/** Calls `visit` on every object in `json`, depth first, in document order. */
function walk(json: unknown, visit: (object: Json) => void) {
  let nodes = 0;
  const step = (value: unknown, depth: number) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      for (const child of value) step(child, depth + 1);
    } else if (isRecord(value)) {
      visit(value);
      for (const child of Object.values(value)) step(child, depth + 1);
    }
  };
  step(json, 0);
}

/** The first post URN in a string, e.g. inside `urn:li:fsd_update:(urn:li:activity:1,…)`. */
export function postUrnOf(value: unknown): string | null {
  return typeof value === 'string' ? (POST_URN.exec(value)?.[0] ?? null) : null;
}

/** LinkedIn ids carry their creation time in the top 41 bits (ms since the Unix epoch). */
export function postedAtOf(urn: string): string | undefined {
  const id = /(\d{5,25})$/.exec(urn)?.[1];
  if (!id) return undefined;
  const ms = Number(BigInt(id) >> 22n);
  // Before LinkedIn existed, or in the future: not a timestamp after all.
  if (ms < Date.UTC(2003, 0, 1) || ms > Date.now() + 86_400_000) return undefined;
  return new Date(ms).toISOString();
}

/** The largest rendition of the first image under `value` (a `vectorImage` or an `imageUrl`). */
export function imageOf(value: unknown): string | undefined {
  let found: string | undefined;
  walk(value, (object) => {
    if (found) return;
    const root = text(object.rootUrl);
    if (root?.startsWith('https://') && Array.isArray(object.artifacts)) {
      let best: { width: number; segment: string } | undefined;
      for (const artifact of object.artifacts) {
        if (!isRecord(artifact)) continue;
        const segment = text(artifact.fileIdentifyingUrlPathSegment);
        const width = number(artifact.width) ?? 0;
        if (segment && (!best || width > best.width)) best = { width, segment };
      }
      if (best) found = `${root}${best.segment}`;
      return;
    }
    const url = isRecord(object.imageUrl) ? text(object.imageUrl.url) : undefined;
    if (url?.startsWith('https://')) found = url;
  });
  return found;
}

interface PostFields {
  urn: string;
  author?: string;
  headline?: string;
  text?: string;
  image?: string;
  articleTitle?: string;
  articleUrl?: string;
}

function toPost({
  urn,
  author,
  headline,
  text: body,
  image,
  articleTitle,
  articleUrl,
}: PostFields) {
  const line = body?.replace(/\s+/g, ' ').trim();
  const postedAt = postedAtOf(urn);
  const post: CapturedPost = {
    externalId: urn,
    url: `${LINKEDIN_ORIGIN}/feed/update/${urn}/`,
    title: line
      ? truncate(line, TITLE_MAX)
      : articleTitle
        ? truncate(articleTitle, TITLE_MAX)
        : author
          ? `Post by ${author}`
          : 'LinkedIn post',
    ...(body && { text: truncate(body, TEXT_MAX) }),
    ...(author && { author }),
    ...(image && { thumbnailUrl: image }),
    // Kept out of `postedAt` on purpose: that would date a first import by when each post was
    // published. LinkedIn posts are dated by when the extension found them saved instead.
    metadata: compact({
      urn,
      postedAt,
      authorHeadline: headline,
      articleTitle,
      articleUrl: articleUrl?.startsWith('https://') ? articleUrl : undefined,
    }),
  };
  return post;
}

/** A post with nothing but its address, for a Save click on a post we haven't read. */
export function minimalPost(urn: string): CapturedPost {
  return toPost({ urn });
}

/** A saved-list result (`EntityResultViewModel`) → a post, or null if it isn't one. */
function entityResultToPost(object: Json): CapturedPost | null {
  const entityUrn = text(object.entityUrn) ?? '';
  const isResult =
    entityUrn.startsWith('urn:li:fsd_entityResultViewModel:') ||
    (text(object.$type) ?? '').endsWith('EntityResultViewModel');
  if (!isResult) return null;
  const urn =
    postUrnOf(entityUrn) ?? postUrnOf(object.trackingUrn) ?? postUrnOf(object.navigationUrl);
  if (!urn) return null;
  const embedded = isRecord(object.entityEmbeddedObject) ? object.entityEmbeddedObject : {};
  return toPost({
    urn,
    author: textOf(object.title),
    headline: textOf(object.primarySubtitle),
    text: textOf(object.summary),
    image: imageOf(embedded.image),
    articleTitle: textOf(embedded.title),
    articleUrl: text(embedded.navigationUrl),
  });
}

/** A feed `Update` → a post, or null if it isn't one. */
function updateToPost(object: Json): CapturedPost | null {
  const entityUrn = text(object.entityUrn) ?? '';
  const isUpdate =
    entityUrn.startsWith('urn:li:fsd_update:') || /\.UpdateV?2?$/.test(text(object.$type) ?? '');
  if (!isUpdate) return null;
  const metadata = isRecord(object.metadata) ? object.metadata : {};
  const updateMetadata = isRecord(object.updateMetadata) ? object.updateMetadata : {};
  const urn =
    postUrnOf(metadata.backendUrn) ?? postUrnOf(updateMetadata.urn) ?? postUrnOf(entityUrn);
  if (!urn) return null;
  const actor = isRecord(object.actor) ? object.actor : {};
  const commentary = isRecord(object.commentary) ? object.commentary : {};
  const content = isRecord(object.content) ? object.content : {};
  const article = isRecord(content.articleComponent) ? content.articleComponent : {};
  const articleTarget = isRecord(article.navigationContext)
    ? text(article.navigationContext.actionTarget)
    : undefined;
  return toPost({
    urn,
    author: textOf(actor.name),
    headline: textOf(actor.description),
    text: textOf(commentary.text),
    image: imageOf(content),
    articleTitle: textOf(article.title),
    articleUrl: articleTarget,
  });
}

/** Posts in list order: by where `data` first refers to each one (see the top of the file). */
function inListOrder(json: unknown, found: { post: CapturedPost; ref?: string }[]) {
  const order = new Map<string, number>();
  walk(isRecord(json) && 'data' in json ? json.data : undefined, (object) => {
    for (const value of Object.values(object)) {
      const refs = Array.isArray(value) ? value : [value];
      for (const ref of refs)
        if (typeof ref === 'string' && !order.has(ref)) order.set(ref, order.size);
    }
  });
  const rank = (ref?: string) => (ref !== undefined ? (order.get(ref) ?? Infinity) : Infinity);
  // Array.prototype.sort is stable: unreferenced posts keep the order they were found in.
  return [...found].sort((a, b) => rank(a.ref) - rank(b.ref)).map(({ post }) => post);
}

function uniquePosts(posts: CapturedPost[]): CapturedPost[] {
  const byId = new Map<string, CapturedPost>();
  for (const post of posts) if (!byId.has(post.externalId)) byId.set(post.externalId, post);
  return [...byId.values()];
}

/** Every feed post in any Voyager response (for a later Save click). */
export function extractFeedPosts(json: unknown): CapturedPost[] {
  const found: CapturedPost[] = [];
  walk(json, (object) => {
    const post = updateToPost(object);
    if (post) found.push(post);
  });
  return uniquePosts(found);
}

export interface SavedPostsPage {
  /** Newest save first, as LinkedIn lists them. */
  posts: CapturedPost[];
  /** How many results the page covered (the step to the next page), when it says. */
  count: number | null;
  /** How many saved posts there are in all, when it says. */
  total: number | null;
}

/** The `paging` of the list in `data`: `{ start, count, total }`. */
function pagingOf(json: unknown): { count: number | null; total: number | null } {
  let paging: Json | undefined;
  walk(isRecord(json) && 'data' in json ? json.data : json, (object) => {
    if (!paging && isRecord(object.paging) && number(object.paging.count) !== undefined) {
      paging = object.paging;
    }
  });
  return { count: number(paging?.count) ?? null, total: number(paging?.total) ?? null };
}

/** A page of the saved-posts list. Feed-style posts count too, should LinkedIn switch to them. */
export function parseSavedPostsPage(json: unknown): SavedPostsPage {
  const results: { post: CapturedPost; ref?: string }[] = [];
  walk(json, (object) => {
    const post = entityResultToPost(object);
    if (post) results.push({ post, ref: text(object.entityUrn) });
  });
  const posts =
    results.length > 0 ? uniquePosts(inListOrder(json, results)) : extractFeedPosts(json);
  return { posts, ...pagingOf(json) };
}

/**
 * The address of page `start` of the saved list, from the address the page itself used:
 * `variables=(start:0,query:(…))` with `start` swapped (or added).
 */
export function savedPostsPageAddress(template: string, start: number): string {
  if (/start(?::|%3A)\d+/i.test(template)) {
    return template.replace(/start(:|%3A)\d+/i, (_, colon: string) => `start${colon}${start}`);
  }
  if (template.includes('variables=(')) {
    return template.replace('variables=(', `variables=(start:${start},`);
  }
  return template.replace(/variables=%28/i, `variables=%28start%3A${start}%2C`);
}

/**
 * The saved list's address when the page didn't show us its own. The query id is the last one
 * known to work; LinkedIn changes it with its deployments, which is why the page's own
 * request is preferred.
 */
export const FALLBACK_SAVED_POSTS_ADDRESS = `/voyager/api/graphql?variables=(start:0,query:(flagshipSearchIntent:${SAVED_POSTS_INTENT}))&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`;

/**
 * LinkedIn renders a page's first data into it: `<code id="datalet-bpr-guid-N">` holds
 * `{ request, body: "bpr-guid-N" }`, and `<code id="bpr-guid-N">` the response. Returns the
 * request and body id when the datalet is the saved list.
 */
export function savedPostsDatalet(textContent: string): { request: string; body: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(textContent);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  const request = text(json.request);
  const body = text(json.body);
  if (!request || !body) return null;
  let address = request;
  try {
    address = decodeURIComponent(request);
  } catch {
    // Keep it as it is.
  }
  return address.includes('SAVED_POSTS') ? { request, body } : null;
}

export interface SaveChange {
  urn: string;
  /** true: saved, false: unsaved, null: the request didn't say plainly. */
  saved: boolean | null;
}

/**
 * A save or unsave request (`op` from `linkedinOperation`): the post's URN from the address
 * (or else the body), and which way it went from the body (`{"patch":{"$set":{"saved":true}}}`).
 */
export function saveChange(op: string, requestBody: string | undefined): SaveChange | null {
  if (!op.startsWith('save-state:')) return null;
  const urn = postUrnOf(op) ?? postUrnOf(requestBody);
  if (!urn) return null;
  const flag = /"saved"\s*:\s*(true|false)/.exec(requestBody ?? '')?.[1];
  return { urn, saved: flag === undefined ? null : flag === 'true' };
}

/**
 * What a clicked control does, from its text or label: LinkedIn's "Save" / "Unsave" (in a
 * post's ⋯ menu, or a button), possibly followed by a description ("Save for later").
 * Anything else, including "Saved items", is null.
 */
export function saveActionOfLabel(label: string): 'save' | 'unsave' | null {
  const first = label.trim().split('\n')[0]?.trim() ?? '';
  if (/^unsave\b/i.test(first)) return 'unsave';
  return /^save\b/i.test(first) ? 'save' : null;
}

/** LinkedIn answers API calls from a signed-out browser with 401/403, or sends it to a login page. */
export function isSignedOutResponse(status: number, url: string): boolean {
  return status === 401 || status === 403 || /\/(login|authwall|checkpoint|uas\/)/.test(url);
}
