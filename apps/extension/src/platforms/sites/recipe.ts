import type { CapturedPost } from '../types';
import { arraysIn, getPath, isRecord, type JsonPath } from './json';

/**
 * A recipe describes, as data, how to read one site's saved list. The learner (learn.ts)
 * writes it once from what the saved page shows; this interpreter runs it on every sync.
 * Recipes contain no code, so they can be stored and shared safely.
 */

// ── Links ────────────────────────────────────────────────────────────────────────

/** One piece of a post link: a path segment, or a query parameter when `key` is set. */
export interface LinkPart {
  key?: string;
  value: string;
}

/** Query parameters that never identify a post. */
const IGNORED_PARAMS = /^(utm_.*|si|feature|ref|ref_src|source|t|pp|list|index|igsh|igshid|s)$/i;

/** A link split into path segments plus identifying query parameters (sorted). */
export function linkParts(url: URL): LinkPart[] {
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return { value: decodeURIComponent(segment) };
      } catch {
        return { value: segment };
      }
    });
  const params = [...url.searchParams]
    .filter(([key, value]) => value && !IGNORED_PARAMS.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }));
  return [...segments, ...params];
}

/** Values that look like an identifier rather than a word: 1234567, C2xYzAb9, urn:li:…, t3_abc12. */
export function looksLikeId(value: string): boolean {
  if (value.length < 5 || value.length > 120) return false;
  if (/^\d{5,}$/.test(value)) return true;
  if (/^urn:[a-z]/i.test(value)) return true;
  if (!/^[A-Za-z0-9_:.-]+$/.test(value)) return false;
  const hasDigit = /\d/.test(value);
  const hasLetter = /[A-Za-z]/.test(value);
  const mixedCase = /[a-z]/.test(value) && /[A-Z]/.test(value);
  // Words joined by - or _ (slugs, usernames) are not ids unless they carry digits.
  return (
    (hasDigit && hasLetter && value.length >= 6) ||
    (mixedCase && value.length >= 8 && !/[-_]/.test(value))
  );
}

/** Same site: same host, or a subdomain of the page's registrable-ish domain. */
export function sameSite(url: URL, page: URL): boolean {
  const base = page.hostname.split('.').slice(-2).join('.');
  return (
    url.hostname === page.hostname || url.hostname.endsWith(`.${base}`) || url.hostname === base
  );
}

export type ShapePart =
  | { kind: 'lit'; value: string; key?: string }
  | { kind: 'id'; key?: string }
  | { kind: 'any'; key?: string };

/** Which links on a page are posts: their shape, e.g. /p/{id}/ or /r/{any}/comments/{id}/. */
export interface LinkShape {
  parts: ShapePart[];
  trailingSlash: boolean;
}

export function matchShape(shape: LinkShape, parts: LinkPart[]): string | null {
  if (parts.length !== shape.parts.length) return null;
  let id: string | null = null;
  for (const [index, part] of shape.parts.entries()) {
    const actual = parts[index]!;
    if ((part.key ?? null) !== (actual.key ?? null)) return null;
    if (part.kind === 'lit' && part.value !== actual.value) return null;
    if (part.kind === 'id') id = actual.value;
  }
  return id;
}

export function shapeText(shape: LinkShape): string {
  const path = shape.parts.filter((part) => !part.key);
  const query = shape.parts.filter((part) => part.key);
  const show = (part: ShapePart) =>
    part.kind === 'lit' ? part.value : part.kind === 'id' ? '{id}' : '{any}';
  return (
    `/${path.map(show).join('/')}${shape.trailingSlash ? '/' : ''}` +
    (query.length > 0 ? `?${query.map((part) => `${part.key}=${show(part)}`).join('&')}` : '')
  );
}

// ── Recipes ──────────────────────────────────────────────────────────────────────

/** A piece of a link template: fixed text, the post id, or a value from the item. */
export type TemplatePart =
  | { kind: 'lit'; value: string; key?: string }
  | { kind: 'id'; key?: string }
  | { kind: 'field'; path: JsonPath; key?: string };

export type LinkRule =
  /** A field holding the post's URL or path. */
  | { kind: 'field'; path: JsonPath }
  /** Built from parts, e.g. /p/{id}/. */
  | { kind: 'template'; parts: TemplatePart[]; trailingSlash: boolean }
  /** Looked up among the links on the page by the post id. */
  | { kind: 'page' };

export interface FieldMap {
  /** Where the post id is; `prefix`/`suffix` are stripped (e.g. "t3_" on Reddit). */
  id: { path: JsonPath; prefix?: string; suffix?: string };
  link: LinkRule;
  text?: JsonPath;
  title?: JsonPath;
  handle?: JsonPath;
  authorName?: JsonPath;
  image?: JsonPath;
  postedAt?: { path: JsonPath; unit: 'seconds' | 'ms' | 'iso' };
}

export interface JsonRecipe {
  /** Where the list sat when it was learned (tried first). */
  itemsPath: JsonPath;
  /** Keys every saved item has: used to find the list if it moves within a response. */
  itemKeys: string[];
  /** For mixed lists (e.g. LinkedIn's `included`): only items with this value. */
  itemFilter?: { path: JsonPath; equals: string };
  fields: FieldMap;
}

export interface DomRecipe {
  shape: LinkShape;
}

export interface SiteRecipe {
  version: 1;
  /** Preferred: the site's own data, which has full text, authors and dates. */
  json?: JsonRecipe;
  /** Fallback: the post links visible on the page. */
  dom?: DomRecipe;
}

/** A link on the page, as the content script saw it. */
export interface PageLink {
  href: string;
  /** The link's own text. */
  text: string;
  /** Text of the smallest block around the link that holds just this post. */
  cardText?: string;
  image?: string;
  inNav: boolean;
}

export interface ExtractContext {
  pageUrl: string;
  label: string;
  /** Links on the page, for `{ kind: 'page' }` link rules. */
  links?: PageLink[];
}

// ── Extraction ───────────────────────────────────────────────────────────────────

const TITLE_MAX = 280;
const TEXT_MAX = 20_000;

function truncate(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max
    ? value
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

const firstLine = (value: string) => value.replace(/\s+/g, ' ').trim();

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

function scalar(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return str(value);
}

function toDate(value: unknown, unit: 'seconds' | 'ms' | 'iso'): string | undefined {
  const time =
    unit === 'iso'
      ? typeof value === 'string'
        ? Date.parse(value)
        : Number.NaN
      : typeof value === 'number' || typeof value === 'string'
        ? Number(value) * (unit === 'seconds' ? 1000 : 1)
        : Number.NaN;
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : undefined;
}

function httpsUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function renderTemplate(
  rule: Extract<LinkRule, { kind: 'template' }>,
  id: string,
  item: unknown,
  pageUrl: string,
): string | undefined {
  const path: string[] = [];
  const query = new URLSearchParams();
  for (const part of rule.parts) {
    const value =
      part.kind === 'lit' ? part.value : part.kind === 'id' ? id : scalar(getPath(item, part.path));
    if (value === undefined) return undefined;
    if (part.key) query.set(part.key, value);
    else path.push(encodeURIComponent(value).replace(/%3A/gi, ':'));
  }
  const queryText = query.toString();
  const search = queryText ? `?${queryText}` : '';
  return httpsUrl(`/${path.join('/')}${rule.trailingSlash ? '/' : ''}${search}`, pageUrl);
}

function findPageLink(id: string, links: PageLink[] | undefined): string | undefined {
  return links?.find((link) => !link.inNav && link.href.includes(id))?.href;
}

function makePost(fields: {
  id: string;
  url: string;
  title?: string;
  text?: string;
  handle?: string;
  authorName?: string;
  image?: string;
  postedAt?: string;
  label: string;
}): CapturedPost {
  const text = fields.text ? truncate(fields.text, TEXT_MAX) : undefined;
  const title = fields.title ?? (text ? firstLine(text) : undefined);
  const handle = fields.handle?.replace(/^@/, '');
  const author =
    fields.authorName && handle && fields.authorName !== handle
      ? `${fields.authorName} (@${handle})`
      : (fields.authorName ?? (handle ? `@${handle}` : undefined));
  return {
    externalId: fields.id,
    url: fields.url,
    title: title ? truncate(firstLine(title), TITLE_MAX) : `Saved on ${fields.label}`,
    ...(text && text !== title && { text }),
    ...(author && { author: truncate(author, 300) }),
    ...(fields.image && { thumbnailUrl: fields.image }),
    ...(fields.postedAt && { postedAt: fields.postedAt }),
    metadata: { learned: true, ...(fields.postedAt && { postedAt: fields.postedAt }) },
  };
}

function itemsFor(recipe: JsonRecipe, json: unknown): unknown[] {
  const exact = getPath(json, recipe.itemsPath);
  if (Array.isArray(exact)) return exact;
  // The list moved (e.g. the first page came embedded in the HTML): find it by its keys.
  return arraysIn(json)
    .filter(({ array }) =>
      array.some(
        (item) =>
          isRecord(item) &&
          recipe.itemKeys.every((key) => key in item) &&
          getPath(item, recipe.fields.id.path) !== undefined,
      ),
    )
    .flatMap(({ array }) => array);
}

/** Posts in one JSON response (or embedded JSON blob), using a learned recipe. */
export function extractJsonPosts(
  recipe: JsonRecipe,
  json: unknown,
  context: ExtractContext,
): CapturedPost[] {
  const { fields } = recipe;
  const posts = new Map<string, CapturedPost>();

  for (const item of itemsFor(recipe, json)) {
    if (!isRecord(item)) continue;
    if (recipe.itemFilter && getPath(item, recipe.itemFilter.path) !== recipe.itemFilter.equals) {
      continue;
    }
    const raw = scalar(getPath(item, fields.id.path));
    const prefix = fields.id.prefix ?? '';
    const suffix = fields.id.suffix ?? '';
    if (!raw?.startsWith(prefix) || !raw.endsWith(suffix)) continue;
    const id = raw.slice(prefix.length, raw.length - suffix.length);
    if (!id || id.length > 512 || posts.has(id)) continue;

    const url =
      fields.link.kind === 'field'
        ? httpsUrl(str(getPath(item, fields.link.path)), context.pageUrl)
        : fields.link.kind === 'template'
          ? renderTemplate(fields.link, id, item, context.pageUrl)
          : findPageLink(id, context.links);
    if (!url) continue;

    posts.set(
      id,
      makePost({
        id,
        url,
        label: context.label,
        title: fields.title && str(getPath(item, fields.title)),
        text: fields.text && str(getPath(item, fields.text)),
        handle: fields.handle && str(getPath(item, fields.handle)),
        authorName: fields.authorName && str(getPath(item, fields.authorName)),
        image: fields.image && httpsUrl(str(getPath(item, fields.image)), context.pageUrl),
        postedAt:
          fields.postedAt && toDate(getPath(item, fields.postedAt.path), fields.postedAt.unit),
      }),
    );
  }
  return [...posts.values()];
}

/** Posts from the links visible on the page, for sites whose data we can't read. */
export function extractDomPosts(recipe: DomRecipe, context: ExtractContext): CapturedPost[] {
  const page = new URL(context.pageUrl);
  const posts = new Map<string, CapturedPost>();
  for (const link of context.links ?? []) {
    if (link.inNav) continue;
    let url: URL;
    try {
      url = new URL(link.href, page);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !sameSite(url, page)) continue;
    const id = matchShape(recipe.shape, linkParts(url));
    if (!id || posts.has(id)) continue;
    url.hash = '';
    const card = link.cardText?.trim();
    const own = link.text.trim();
    posts.set(
      id,
      makePost({
        id,
        url: url.toString(),
        label: context.label,
        title: own.length >= 8 ? own : card,
        text: card && card !== own ? card : undefined,
        image: httpsUrl(link.image, context.pageUrl),
      }),
    );
  }
  return [...posts.values()];
}

// ── Validation (recipes cross from a page's content script to the background) ─────

const isPath = (value: unknown): value is JsonPath =>
  Array.isArray(value) &&
  value.length <= 24 &&
  value.every((key) => typeof key === 'string' || (typeof key === 'number' && key >= 0));

const optionalPath = (value: unknown) => value === undefined || isPath(value);

function isShapePart(value: unknown): boolean {
  if (!isRecord(value) || (value.key !== undefined && typeof value.key !== 'string')) return false;
  if (value.kind === 'lit') return typeof value.value === 'string';
  if (value.kind === 'field') return isPath(value.path);
  return value.kind === 'id' || value.kind === 'any';
}

function isLinkRule(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'field') return isPath(value.path);
  if (value.kind === 'page') return true;
  return (
    value.kind === 'template' &&
    Array.isArray(value.parts) &&
    value.parts.length <= 24 &&
    value.parts.every(isShapePart) &&
    typeof value.trailingSlash === 'boolean'
  );
}

export function isSiteRecipe(value: unknown): value is SiteRecipe {
  if (!isRecord(value) || value.version !== 1) return false;
  if (JSON.stringify(value).length > 20_000) return false;
  const { json, dom } = value;
  if (json === undefined && dom === undefined) return false;
  if (json !== undefined) {
    if (!isRecord(json) || !isPath(json.itemsPath) || !isRecord(json.fields)) return false;
    if (!Array.isArray(json.itemKeys) || !json.itemKeys.every((key) => typeof key === 'string')) {
      return false;
    }
    const fields = json.fields;
    if (!isRecord(fields.id) || !isPath(fields.id.path) || !isLinkRule(fields.link)) return false;
    for (const key of ['text', 'title', 'handle', 'authorName', 'image'] as const) {
      if (!optionalPath(fields[key])) return false;
    }
    if (
      fields.postedAt !== undefined &&
      (!isRecord(fields.postedAt) || !isPath(fields.postedAt.path))
    ) {
      return false;
    }
  }
  if (dom !== undefined) {
    if (!isRecord(dom) || !isRecord(dom.shape) || !Array.isArray(dom.shape.parts)) return false;
    if (!dom.shape.parts.every(isShapePart)) return false;
  }
  return true;
}
