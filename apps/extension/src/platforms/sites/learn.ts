import type { CapturedPost } from '../types';
import { arraysIn, isRecord, type Json, type JsonPath, type Leaf, leaves, pathText } from './json';
import {
  type DomRecipe,
  extractDomPosts,
  extractJsonPosts,
  type FieldMap,
  type JsonRecipe,
  type LinkPart,
  linkParts,
  type LinkRule,
  type LinkShape,
  looksLikeId,
  type PageLink,
  sameSite,
  type ShapePart,
  shapeText,
  type SiteRecipe,
  type TemplatePart,
} from './recipe';

/**
 * Learns how to read a saved list on a site it has never seen, from two things the page
 * already has: the links on screen and the data the page loaded.
 *
 *  1. Post links: links that share a shape with an id in it (/p/{id}/, /pin/{id}/,
 *     /r/…/comments/{id}/…). Several shapes are tried, best first.
 *  2. The list: among every array in the loaded data, the one whose items contain those
 *     ids. Matching against what is on screen is what tells the saved list apart from ads,
 *     suggestions and profiles.
 *  3. Fields: inside the matching items, text, author, image and date are recognised by
 *     their key names and the shape of their values.
 *
 * If no data matches, the links themselves become the recipe (title and text from the page).
 */

const POST_KEYWORDS = new Set([
  'p',
  'post',
  'posts',
  'status',
  'statuses',
  'comments',
  'update',
  'pin',
  'pins',
  'reel',
  'reels',
  'video',
  'videos',
  'watch',
  'item',
  'items',
  'story',
  'stories',
  'article',
  'articles',
  'tweet',
  'dp',
  'question',
  'questions',
  'entry',
  'entries',
  'media',
  'photo',
  'photos',
  'shorts',
  'feed',
]);
/** Fewer than this and we can't tell a list from a coincidence. */
const MIN_POSTS = 2;
const GROUPS_TO_TRY = 4;
/** Share of sampled items a field must agree on to be trusted. */
const AGREEMENT = 0.7;

export interface Capture {
  /** Where the JSON came from (a request shape, or "inline"); for the report only. */
  source: string;
  json: unknown;
}

export interface LearnInput {
  pageUrl: string;
  label: string;
  links: PageLink[];
  captures: Capture[];
}

/** What the learner saw and decided: structure only (paths, counts), never post content. */
export interface LearnReport {
  links: number;
  linkGroups: { shape: string; posts: number }[];
  arrays: { source: string; path: string; items: number; matched: number }[];
  method?: 'json' | 'dom';
  chosen?: { shape: string; array?: string; fields?: Record<string, string> };
  problem?: string;
}

export interface LearnResult {
  recipe: SiteRecipe | null;
  posts: CapturedPost[];
  report: LearnReport;
}

// ── 1. Post links ────────────────────────────────────────────────────────────────

interface ParsedLink {
  link: PageLink;
  url: URL;
  parts: LinkPart[];
}

interface LinkGroup {
  shape: LinkShape;
  idIndex: number;
  /** One link per post id. */
  byId: Map<string, ParsedLink>;
  score: number;
}

function isIdAt(parts: LinkPart[], index: number): boolean {
  const part = parts[index]!;
  if (looksLikeId(part.value)) return true;
  // Short ids right after a keyword, e.g. /comments/1abcde/ on Reddit.
  const previous = parts[index - 1];
  return (
    !part.key &&
    previous !== undefined &&
    !previous.key &&
    POST_KEYWORDS.has(previous.value.toLowerCase()) &&
    /^[A-Za-z0-9_-]{3,40}$/.test(part.value)
  );
}

function findLinkGroups(links: PageLink[], page: URL): LinkGroup[] {
  const groups = new Map<string, ParsedLink[]>();
  for (const link of links) {
    if (link.inNav) continue;
    let url: URL;
    try {
      url = new URL(link.href, page);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !sameSite(url, page)) continue;
    if (url.pathname === page.pathname && url.search === page.search) continue;
    const parts = linkParts(url);
    if (parts.length === 0) continue;
    const key = parts
      .map((part, index) => `${part.key ? `${part.key}=` : ''}${isIdAt(parts, index) ? '#' : '.'}`)
      .join('/');
    if (!key.includes('#')) continue;
    groups.set(key, [...(groups.get(key) ?? []), { link, url, parts }]);
  }

  const result: LinkGroup[] = [];
  for (const members of groups.values()) {
    const first = members[0]!;
    const width = first.parts.length;
    const distinct = (index: number) => new Set(members.map((m) => m.parts[index]!.value));
    const idPositions = first.parts
      .map((_, index) => index)
      .filter((index) => isIdAt(first.parts, index));
    // The id is the position with the most distinct values (last one wins a tie).
    const idIndex = idPositions.reduce((best, index) =>
      distinct(index).size >= distinct(best).size ? index : best,
    );

    const parts: ShapePart[] = [];
    let hasKeyword = false;
    for (let index = 0; index < width; index++) {
      const key = first.parts[index]!.key;
      const values = distinct(index);
      const withKey = key ? { key } : {};
      if (index === idIndex) parts.push({ kind: 'id', ...withKey });
      else if (values.size === 1) {
        const value = first.parts[index]!.value;
        if (POST_KEYWORDS.has(value.toLowerCase())) hasKeyword = true;
        parts.push({ kind: 'lit', value, ...withKey });
      } else parts.push({ kind: 'any', ...withKey });
    }

    const byId = new Map<string, ParsedLink>();
    for (const member of members) {
      const id = member.parts[idIndex]!.value;
      if (!byId.has(id)) byId.set(id, member);
    }
    if (byId.size < MIN_POSTS) continue;
    const slashes = members.filter((m) => m.url.pathname.endsWith('/')).length;
    result.push({
      shape: { parts, trailingSlash: slashes * 2 > members.length },
      idIndex,
      byId,
      score: byId.size * (hasKeyword ? 2 : 1),
    });
  }
  return result.sort((a, b) => b.score - a.score);
}

// ── 2. The list in the loaded data ───────────────────────────────────────────────

interface ItemMatch {
  item: Json;
  id: string;
  leaf: Leaf;
  exact: boolean;
}

interface ListCandidate {
  source: string;
  path: (string | number)[];
  size: number;
  matches: ItemMatch[];
  distinct: number;
}

function matchItem(item: Json, ids: ReadonlySet<string>, idList: string[]): ItemMatch | null {
  const values = leaves(item, 6);
  for (const leaf of values) {
    const value = String(leaf.value);
    if (ids.has(value)) return { item, id: value, leaf, exact: true };
  }
  for (const leaf of values) {
    if (typeof leaf.value !== 'string' || leaf.value.length > 300) continue;
    const id = idList.find((candidate) => (leaf.value as string).includes(candidate));
    if (id) return { item, id, leaf, exact: false };
  }
  return null;
}

function findList(
  group: LinkGroup,
  captures: Capture[],
  report: LearnReport,
): ListCandidate | null {
  const ids = new Set(group.byId.keys());
  const idList = [...ids].filter((id) => id.length >= 4);
  let best: ListCandidate | null = null;

  for (const capture of captures) {
    for (const { path, array } of arraysIn(capture.json)) {
      const objects = array.filter(isRecord);
      if (objects.length < MIN_POSTS || objects.length > 2_000) continue;
      const matches = objects
        .slice(0, 300)
        .map((item) => matchItem(item, ids, idList))
        .filter((match): match is ItemMatch => match !== null);
      const distinct = new Set(matches.map((match) => match.id)).size;
      if (distinct < MIN_POSTS) continue;
      report.arrays.push({
        source: capture.source,
        path: pathText(path),
        items: objects.length,
        matched: distinct,
      });
      // More posts explained wins; on a tie, the tighter list (fewer unrelated items).
      if (
        !best ||
        distinct > best.distinct ||
        (distinct === best.distinct && objects.length < best.size)
      ) {
        best = { source: capture.source, path, size: objects.length, matches, distinct };
      }
    }
  }
  return best;
}

// ── 3. Fields ────────────────────────────────────────────────────────────────────

const keyOf = (path: JsonPath) => path.join('\u0000');
const lastKey = (path: JsonPath) =>
  [...path].reverse().find((key): key is string => typeof key === 'string') ?? '';
const USERISH = /user|author|owner|actor|creator|profile|poster|channel|account|by$/i;
const TITLE_KEY = /^(title|headline|name|subject|link_title|heading)$/i;
const isUserish = (path: JsonPath) => path.slice(0, -1).some((key) => USERISH.test(String(key)));

function mostCommon<T>(values: T[], key: (value: T) => string): { value: T; share: number } | null {
  const counts = new Map<string, { value: T; count: number }>();
  for (const value of values) {
    const k = key(value);
    const entry = counts.get(k) ?? { value, count: 0 };
    entry.count += 1;
    counts.set(k, entry);
  }
  const top = [...counts.values()].sort((a, b) => b.count - a.count)[0];
  return top ? { value: top.value, share: top.count / values.length } : null;
}

interface Stat {
  path: (string | number)[];
  strings: string[];
  numbers: number[];
}

function fieldStats(items: Json[], exclude: Set<string>): Stat[] {
  const stats = new Map<string, Stat>();
  for (const item of items) {
    for (const leaf of leaves(item, 7)) {
      const key = keyOf(leaf.path);
      if (exclude.has(key)) continue;
      const stat = stats.get(key) ?? { path: leaf.path, strings: [], numbers: [] };
      if (typeof leaf.value === 'string') stat.strings.push(leaf.value);
      else stat.numbers.push(leaf.value);
      stats.set(key, stat);
    }
  }
  return [...stats.values()];
}

const average = (values: number[]) =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const distinctShare = (values: string[]) =>
  values.length === 0 ? 0 : new Set(values).size / values.length;
const isUrlish = (value: string) => /^(https?:)?\/\//.test(value) || value.startsWith('/');

function best<T>(candidates: T[], score: (candidate: T) => number): T | undefined {
  return candidates
    .map((candidate) => ({ candidate, score: score(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.candidate;
}

function pickFields(items: Json[], exclude: Set<string>) {
  const n = items.length;
  const stats = fieldStats(items, exclude);
  const presence = (stat: Stat) => (stat.strings.length + stat.numbers.length) / n;
  const strings = stats.filter((stat) => stat.strings.length > 0);

  const text = best(strings, (stat) => {
    const lengths = stat.strings.map((value) => value.length);
    if (TITLE_KEY.test(lastKey(stat.path))) return 0;
    if (presence(stat) < 0.3 || average(lengths) < 15) return 0;
    if (stat.strings.filter(isUrlish).length > stat.strings.length / 2) return 0;
    if (distinctShare(stat.strings) < 0.6 || isUserish(stat.path)) return 0;
    const keyBonus =
      /text|caption|body|content|description|commentary|selftext|summary|message/i.test(
        lastKey(stat.path),
      )
        ? 0.6
        : 0;
    return (
      presence(stat) + Math.min(average(lengths), 400) / 400 + keyBonus - stat.path.length * 0.02
    );
  });

  const title = best(strings, (stat) => {
    if (stat === text || isUserish(stat.path)) return 0;
    const key = lastKey(stat.path);
    if (!TITLE_KEY.test(key)) return 0;
    // Internal names like "t3_1abcde" are ids, not titles.
    if (stat.strings.filter(looksLikeId).length > stat.strings.length / 2) return 0;
    const avg = average(stat.strings.map((value) => value.length));
    if (presence(stat) < 0.3 || avg < 3 || avg > 300 || distinctShare(stat.strings) < 0.5) return 0;
    return presence(stat) + 0.5 + (/^(title|headline)$/i.test(key) ? 0.3 : 0);
  });

  const handle = best(strings, (stat) => {
    if (
      !/^(username|screen_name|user_name|handle|login|public_identifier|unique_id|uniqueid|author|vanity_name)$/i.test(
        lastKey(stat.path),
      )
    ) {
      return 0;
    }
    const short = stat.strings.filter((value) => value.length <= 60 && !/\s/.test(value));
    if (presence(stat) < 0.5 || short.length < stat.strings.length * 0.8) return 0;
    return presence(stat) + (isUserish(stat.path) ? 0.5 : 0);
  });

  const authorName = best(strings, (stat) => {
    if (stat === title || !isUserish(stat.path)) return 0;
    const key = lastKey(stat.path);
    // `actor.name.text`-style wrappers count as a name too.
    const wrappedName = key === 'text' && stat.path.some((part) => /name/i.test(String(part)));
    if (
      !/^(full_name|fullname|display_name|displayname|name|author_name)$/i.test(key) &&
      !wrappedName
    ) {
      return 0;
    }
    const avg = average(stat.strings.map((value) => value.length));
    return presence(stat) >= 0.5 && avg <= 100 ? presence(stat) : 0;
  });

  const image = best(strings, (stat) => {
    const https = stat.strings.filter((value) => value.startsWith('https://'));
    if (https.length < n * 0.3 || https.length < stat.strings.length * 0.8) return 0;
    const key = lastKey(stat.path);
    const pathHint = stat.path.some((part) =>
      /image|thumb|media|cover|candidates|preview|photo/i.test(String(part)),
    );
    const looksLikeImage =
      /(url|src|image|img|thumb|display|picture|cover|poster|preview)/i.test(key) ||
      https.some((value) => /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(value));
    if (!looksLikeImage && !pathHint) return 0;
    return presence(stat) + (pathHint ? 0.5 : 0) - (isUserish(stat.path) ? 0.8 : 0);
  });

  const postedAt = best(
    stats.map((stat) => ({ stat, unit: dateUnit(stat) })),
    ({ stat, unit }) => {
      if (!unit || presence(stat) < 0.5) return 0;
      return presence(stat) + (/creat|taken|publish|posted/i.test(lastKey(stat.path)) ? 0.5 : 0);
    },
  );

  return { text, title, handle, authorName, image, postedAt };
}

function dateUnit(stat: Stat): 'seconds' | 'ms' | 'iso' | undefined {
  if (!/(creat|taken|post|publish|time|date|added|saved)/i.test(lastKey(stat.path)))
    return undefined;
  if (stat.numbers.length > 0) {
    if (stat.numbers.every((value) => value > 1e9 && value < 4.1e9)) return 'seconds';
    if (stat.numbers.every((value) => value > 1e12 && value < 4.1e12)) return 'ms';
    return undefined;
  }
  return stat.strings.every(
    (value) => /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value)),
  )
    ? 'iso'
    : undefined;
}

// ── Links for list items ─────────────────────────────────────────────────────────

const trimSlash = (path: string) => path.replace(/\/+$/, '') || '/';

function linkRuleFor(group: LinkGroup, matches: ItemMatch[], pageUrl: string): LinkRule {
  // (a) A field that already holds the post's link.
  const candidates = new Map<string, { path: (string | number)[]; hits: number }>();
  for (const { item, id } of matches) {
    const expected = group.byId.get(id);
    if (!expected) continue;
    for (const leaf of leaves(item, 7)) {
      if (typeof leaf.value !== 'string' || !isUrlish(leaf.value)) continue;
      try {
        const url = new URL(leaf.value, pageUrl);
        if (trimSlash(url.pathname) !== trimSlash(expected.url.pathname)) continue;
      } catch {
        continue;
      }
      const entry = candidates.get(keyOf(leaf.path)) ?? { path: leaf.path, hits: 0 };
      entry.hits += 1;
      candidates.set(keyOf(leaf.path), entry);
    }
  }
  const field = [...candidates.values()]
    .filter((entry) => entry.hits >= matches.length * AGREEMENT)
    .sort((a, b) => b.hits - a.hits || a.path.length - b.path.length)[0];
  if (field) return { kind: 'field', path: field.path };

  // (b) A template from the link shape; varying parts are filled from the item.
  const parts: TemplatePart[] = [];
  for (const [index, part] of group.shape.parts.entries()) {
    const withKey = part.key ? { key: part.key } : {};
    if (part.kind === 'lit') parts.push({ kind: 'lit', value: part.value, ...withKey });
    else if (part.kind === 'id') parts.push({ kind: 'id', ...withKey });
    else {
      const source = fieldMatching(
        matches,
        (match) => group.byId.get(match.id)?.parts[index]?.value,
      );
      const seen = [...group.byId.values()].map((member) => member.parts[index]!.value);
      const common = mostCommon(seen, (value) => value);
      if (source) parts.push({ kind: 'field', path: source, ...withKey });
      else if (index > group.idIndex && !part.key)
        continue; // e.g. a trailing title slug.
      // A handful of values (Instagram's /p/ and /reel/): the most common one works for all.
      else if (common && new Set(seen).size <= 3) {
        parts.push({ kind: 'lit', value: common.value, ...withKey });
      } else return { kind: 'page' }; // (c) Look the link up on the page instead.
    }
  }
  return { kind: 'template', parts, trailingSlash: group.shape.trailingSlash };
}

/** A path whose value equals `expected(match)` in most matched items. */
function fieldMatching(
  matches: ItemMatch[],
  expected: (match: ItemMatch) => string | undefined,
): (string | number)[] | undefined {
  const hits = new Map<string, { path: (string | number)[]; count: number }>();
  for (const match of matches) {
    const want = expected(match);
    if (want === undefined) continue;
    for (const leaf of leaves(match.item, 7)) {
      if (String(leaf.value) !== want) continue;
      const entry = hits.get(keyOf(leaf.path)) ?? { path: leaf.path, count: 0 };
      entry.count += 1;
      hits.set(keyOf(leaf.path), entry);
    }
  }
  return [...hits.values()]
    .filter((entry) => entry.count >= matches.length * AGREEMENT)
    .sort((a, b) => b.count - a.count || a.path.length - b.path.length)[0]?.path;
}

// ── Putting it together ──────────────────────────────────────────────────────────

const DISCRIMINATORS = ['$type', '__typename', 'type', 'entityType', '_type', 'kind', '__type'];

function learnJson(
  group: LinkGroup,
  input: LearnInput,
  report: LearnReport,
): {
  recipe: JsonRecipe;
  posts: CapturedPost[];
  fields: Record<string, string>;
  array: string;
} | null {
  const list = findList(group, input.captures, report);
  if (!list) return null;
  const sample = list.matches.slice(0, 40);

  // The id: where most items hold it exactly, or with a fixed prefix/suffix ("t3_abc12").
  const exact = sample.filter((match) => match.exact);
  let id: FieldMap['id'] | null = null;
  const exactPath = mostCommon(exact, (match) => keyOf(match.leaf.path));
  if (exactPath && exact.length >= sample.length * AGREEMENT) {
    id = { path: exactPath.value.leaf.path };
  } else {
    const wrapped = sample.map((match) => {
      const value = String(match.leaf.value);
      const at = value.indexOf(match.id);
      return {
        match,
        prefix: value.slice(0, at),
        suffix: value.slice(at + match.id.length),
      };
    });
    const common = mostCommon(
      wrapped,
      (w) => `${keyOf(w.match.leaf.path)}|${w.prefix}|${w.suffix}`,
    );
    if (common && common.share >= AGREEMENT) {
      id = {
        path: common.value.match.leaf.path,
        ...(common.value.prefix && { prefix: common.value.prefix }),
        ...(common.value.suffix && { suffix: common.value.suffix }),
      };
    }
  }
  if (!id) return null;

  const items = sample.map((match) => match.item);
  let itemFilter: JsonRecipe['itemFilter'];
  if (list.distinct < list.size * AGREEMENT) {
    for (const key of DISCRIMINATORS) {
      const values = new Set(items.map((item) => item[key]));
      const [value] = values;
      if (values.size === 1 && typeof value === 'string') {
        itemFilter = { path: [key], equals: value };
        break;
      }
    }
  }
  const itemKeys = Object.keys(items[0]!)
    .filter((key) => items.every((item) => key in item))
    .slice(0, 6);

  const link = linkRuleFor(group, sample, input.pageUrl);
  const exclude = new Set([keyOf(id.path), ...(link.kind === 'field' ? [keyOf(link.path)] : [])]);
  const picked = pickFields(items, exclude);
  const fields: FieldMap = {
    id,
    link,
    ...(picked.text && { text: picked.text.path }),
    ...(picked.title && { title: picked.title.path }),
    ...(picked.handle && { handle: picked.handle.path }),
    ...(picked.authorName && { authorName: picked.authorName.path }),
    ...(picked.image && { image: picked.image.path }),
    ...(picked.postedAt?.unit && {
      postedAt: { path: picked.postedAt.stat.path, unit: picked.postedAt.unit },
    }),
  };
  const recipe: JsonRecipe = {
    itemsPath: list.path,
    itemKeys,
    ...(itemFilter && { itemFilter }),
    fields,
  };

  const context = { pageUrl: input.pageUrl, label: input.label, links: input.links };
  const posts = new Map<string, CapturedPost>();
  for (const capture of input.captures) {
    for (const post of extractJsonPosts(recipe, capture.json, context)) {
      if (!posts.has(post.externalId)) posts.set(post.externalId, post);
    }
  }

  const describe: Record<string, string> = {
    id: pathText(id.path),
    link: link.kind === 'field' ? pathText(link.path) : link.kind,
  };
  for (const [name, path] of Object.entries(fields)) {
    if (Array.isArray(path)) describe[name] = pathText(path as JsonPath);
  }
  if (fields.postedAt)
    describe.postedAt = `${pathText(fields.postedAt.path)} (${fields.postedAt.unit})`;

  return {
    recipe,
    posts: [...posts.values()],
    fields: describe,
    array: `${list.source} → ${pathText(list.path)}`,
  };
}

const NO_LINKS =
  "Couldn't find links to individual posts on this page. Open the page that lists your saved posts, with a few of them visible, and try again.";

export function learnSite(input: LearnInput): LearnResult {
  const page = new URL(input.pageUrl);
  const groups = findLinkGroups(input.links, page);
  const report: LearnReport = {
    links: input.links.length,
    linkGroups: groups.slice(0, 8).map((group) => ({
      shape: shapeText(group.shape),
      posts: group.byId.size,
    })),
    arrays: [],
  };
  if (groups.length === 0)
    return { recipe: null, posts: [], report: { ...report, problem: NO_LINKS } };

  // Prefer the site's own data: try the likeliest link shapes, keep what explains most posts.
  let bestJson: { group: LinkGroup; result: NonNullable<ReturnType<typeof learnJson>> } | null =
    null;
  for (const group of groups.slice(0, GROUPS_TO_TRY)) {
    const result = learnJson(group, input, report);
    if (result && result.posts.length >= MIN_POSTS) {
      if (!bestJson || result.posts.length > bestJson.result.posts.length)
        bestJson = { group, result };
    }
  }

  if (bestJson) {
    const dom: DomRecipe = { shape: bestJson.group.shape };
    return {
      recipe: { version: 1, json: bestJson.result.recipe, dom },
      posts: bestJson.result.posts,
      report: {
        ...report,
        method: 'json',
        chosen: {
          shape: shapeText(bestJson.group.shape),
          array: bestJson.result.array,
          fields: bestJson.result.fields,
        },
      },
    };
  }

  // Fall back to the links on the page.
  const top = groups[0]!;
  const dom: DomRecipe = { shape: top.shape };
  const posts = extractDomPosts(dom, {
    pageUrl: input.pageUrl,
    label: input.label,
    links: input.links,
  });
  if (posts.length < MIN_POSTS)
    return { recipe: null, posts: [], report: { ...report, problem: NO_LINKS } };
  return {
    recipe: { version: 1, dom },
    posts,
    report: { ...report, method: 'dom', chosen: { shape: shapeText(top.shape) } },
  };
}
