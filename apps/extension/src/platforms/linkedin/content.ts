/**
 * Isolated content script on www.linkedin.com (registered only while LinkedIn is connected).
 * Three ways a saved post reaches the inbox:
 *  - sync:    the background opened your saved-posts page; the list is read page by page from
 *             LinkedIn's own API, the way the page asks for it, no scrolling needed. Each sync
 *             reads the whole list, so posts unsaved elsewhere (your phone) are removed too.
 *  - passive: you open or scroll your own saved-posts page; whatever it loads is synced.
 *  - live:    you click Save (or Unsave) on any post; it is sent straight away (or removed).
 *
 * Live saves don't rely on recognising LinkedIn's save request, which it renames and moves
 * around: a click on Save/Unsave, or any request that mentions saving, only says "something
 * may have changed". The saved list is then read again, and that decides what to send.
 */
import { sendToBackground } from '../../messages';
import { createRunner } from '../runner';
import { listenToTap } from '../tap';
import type { CapturedPost, SessionInfo } from '../types';
import { LINKEDIN_TAP_TAG, POST_URN, SAVED_POSTS_PATH } from './constants';
import {
  extractFeedPosts,
  FALLBACK_SAVED_POSTS_ADDRESS,
  isSignedOutResponse,
  parseSavedPostsPage,
  saveActionOfLabel,
  saveChange,
  savedPostsDatalet,
  savedPostsPageAddress,
} from './parse';

const RETRY_DELAY_MS = 3_000;
/** How long a sync waits to see the page ask for its saved list, before using a known address. */
const ADDRESS_WAIT_MS = 10_000;
/**
 * When to read the saved list after a Save click: LinkedIn takes a moment to record a save,
 * and sometimes longer to list it, so it is read twice.
 */
const LIVE_CHECK_DELAYS_MS = [1_500, 6_000];
const RECENT_LIMIT = 3_000;
/** Pages of the saved list read in place after an unsave (beyond: a background sync). */
const MAX_LIST_PAGES = 20;
/** The saved list's address, kept for pages that never load the list (the feed). */
const ADDRESS_STORAGE_KEY = 'linkedinSavedListAddress';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SignedOutError extends Error {}

const onSavedPage = () => window.location.pathname.startsWith(SAVED_POSTS_PATH);

/** LinkedIn's API wants the session cookie's value back as a CSRF token, like its web app sends. */
function csrfToken(): string | null {
  return /(?:^|;\s*)JSESSIONID="?([^";]+)"?/.exec(document.cookie)?.[1] ?? null;
}

/** Same-origin API requests with your LinkedIn cookies, like the web app's own. */
async function getJson(path: string): Promise<unknown> {
  const token = csrfToken();
  if (!token) throw new SignedOutError();
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      accept: 'application/vnd.linkedin.normalized+json+2.1',
      'csrf-token': token,
      'x-restli-protocol-version': '2.0.0',
    },
  });
  if (isSignedOutResponse(response.status, response.url)) throw new SignedOutError();
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok || json === null) throw new Error(`LinkedIn answered ${response.status}`);
  return json;
}

async function withRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (error instanceof SignedOutError) throw error;
    await sleep(RETRY_DELAY_MS);
    return load();
  }
}

/** Posts seen on this page, so a Save click can be sent with the post's content. */
const recent = new Map<string, CapturedPost>();

function remember(posts: CapturedPost[]) {
  for (const post of posts) {
    recent.delete(post.externalId); // Re-insert as newest.
    recent.set(post.externalId, post);
  }
  for (const oldest of recent.keys()) {
    if (recent.size <= RECENT_LIMIT) break;
    recent.delete(oldest);
  }
}

// ── The saved list's address ─────────────────────────────────────────────────────────

/** The address the page used for its saved list (it carries LinkedIn's current query id). */
let savedAddress: string | null = null;

/** The address a saved-posts page used last time, on any tab. */
const storedAddress: Promise<string | null> = chrome.storage.local
  .get(ADDRESS_STORAGE_KEY)
  .then((stored) => {
    const value = stored[ADDRESS_STORAGE_KEY];
    return typeof value === 'string' ? value : null;
  })
  .catch(() => null);

function rememberAddress(address: string) {
  if (address === savedAddress) return;
  savedAddress = address;
  void chrome.storage.local.set({ [ADDRESS_STORAGE_KEY]: address }).catch(() => undefined);
}

/** The saved list LinkedIn rendered into the page, with the address it came from. */
function readDatalets(): { address: string; json: unknown }[] {
  const found: { address: string; json: unknown }[] = [];
  for (const node of document.querySelectorAll('code[id^="datalet-bpr-guid-"]')) {
    const datalet = savedPostsDatalet(node.textContent ?? '');
    if (!datalet) continue;
    const body = document.getElementById(datalet.body)?.textContent;
    let json: unknown = null;
    try {
      if (body) json = JSON.parse(body);
    } catch {
      // The address alone is still worth having.
    }
    found.push({ address: datalet.request, json });
  }
  return found;
}

/** For a sync on the saved page: the page's own address, if it shows it within a few seconds. */
async function savedListAddress(): Promise<string> {
  const deadline = Date.now() + ADDRESS_WAIT_MS;
  while (!savedAddress && Date.now() < deadline) {
    const rendered = readDatalets()[0]?.address;
    if (rendered) rememberAddress(rendered);
    else await sleep(500);
  }
  return savedAddress ?? (await storedAddress) ?? FALLBACK_SAVED_POSTS_ADDRESS;
}

/** The first page of the saved list, read now (for live saves, from any page). */
async function readFirstPage() {
  const address = savedAddress ?? (await storedAddress) ?? FALLBACK_SAVED_POSTS_ADDRESS;
  const page = parseSavedPostsPage(
    await withRetry(() => getJson(savedPostsPageAddress(address, 0))),
  );
  remember(page.posts);
  return page;
}

// ── Sync: read the list page by page ────────────────────────────────────────────────

const session: Promise<SessionInfo> = sendToBackground({
  type: 'platform:session',
  platform: 'linkedin',
}).catch((): SessionInfo => ({ mode: 'passive' }));

let signedOut = false;
let nextStart = 0;
let reachedEnd = false;
let loading: Promise<void> | null = null;

async function loadNextPage() {
  if (reachedEnd || signedOut) return;
  try {
    const address = savedPostsPageAddress(await savedListAddress(), nextStart);
    const page = parseSavedPostsPage(await withRetry(() => getJson(address)));
    remember(page.posts);
    const step = Math.max(page.count ?? 0, page.posts.length);
    nextStart += step;
    reachedEnd = page.posts.length === 0 || (page.total !== null && nextStart >= page.total);
    runner.listPage({
      posts: page.posts,
      hasMore: !reachedEnd,
      // Only LinkedIn saying so, on the first page, counts as an empty list.
      ...(step === 0 && nextStart === 0 && page.total === 0 && { empty: true }),
    });
  } catch (error) {
    if (error instanceof SignedOutError) signedOut = true;
    throw error;
  }
}

const runner = createRunner({
  platform: 'linkedin',
  label: 'LinkedIn',
  isListPage: () =>
    !signedOut && !/^\/(login|authwall|checkpoint|uas)\b/.test(window.location.pathname),
  session,
  // Read to the end every time: removes posts unsaved where the extension couldn't see it.
  readWholeList: true,
  // One page at a time, even if the runner asks again while a slow one is still loading.
  loadMore: () =>
    (loading ??= loadNextPage().finally(() => {
      loading = null;
    })),
});

// ── Passive: you browse your own saved-posts page ───────────────────────────────────

void session.then((info) => {
  if (info.mode !== 'passive') return;
  const readRendered = () => {
    if (!onSavedPage()) return;
    for (const { json } of readDatalets()) {
      const page = parseSavedPostsPage(json);
      remember(page.posts);
      if (page.posts.length > 0) runner.listPage({ posts: page.posts, hasMore: true });
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', readRendered, { once: true });
  } else {
    readRendered();
  }
});

// ── Live: Save / Unsave anywhere on LinkedIn ────────────────────────────────────────

let checkTimers: ReturnType<typeof setTimeout>[] = [];

/** Read the top of the saved list: whatever is new there was just saved. */
async function checkSavedList() {
  const page = await readFirstPage();
  // Posts already in the inbox are only refreshed; new ones are dated now.
  runner.saved(page.posts);
}

/** Reads the whole saved list (every page) and reports it, so what is gone is removed. */
async function checkWholeList() {
  const address = savedAddress ?? (await storedAddress) ?? FALLBACK_SAVED_POSTS_ADDRESS;
  const ids: string[] = [];
  let start = 0;
  for (let pages = 0; pages < MAX_LIST_PAGES; pages++) {
    const page = parseSavedPostsPage(
      await withRetry(() => getJson(savedPostsPageAddress(address, start))),
    );
    remember(page.posts);
    ids.push(...page.posts.map((post) => post.externalId));
    const step = Math.max(page.count ?? 0, page.posts.length);
    start += step;
    const end = page.posts.length === 0 || (page.total !== null && start >= page.total);
    if (end) {
      runner.listed(ids, ids.length === 0 && page.total === 0);
      return;
    }
  }
  // Longer than we read here: the background reads it in a tab instead.
  runner.recheck();
}

let wholeListTimers: ReturnType<typeof setTimeout>[] = [];

/**
 * Something was saved or unsaved:
 *  - a save: read the top of the saved list shortly (again if more follow); it shows up there;
 *  - an unsave: read the whole saved list, which removes whatever is gone. LinkedIn's unsave
 *    request names the post by an id its saved list doesn't use, so the list decides; a
 *    post that is named and matches is removed straight away too;
 *  - unknown: both.
 */
function savedStateChanged(action: 'save' | 'unsave' | null, urn: string | null) {
  if (action !== 'save') {
    if (action === 'unsave' && urn) runner.unsaved([urn]);
    for (const timer of wholeListTimers) clearTimeout(timer);
    wholeListTimers = LIVE_CHECK_DELAYS_MS.map((delay) =>
      setTimeout(() => void checkWholeList().catch(() => runner.recheck()), delay),
    );
  }
  if (action === 'unsave') return;
  for (const timer of checkTimers) clearTimeout(timer);
  checkTimers = LIVE_CHECK_DELAYS_MS.map((delay) =>
    setTimeout(() => void checkSavedList().catch(() => undefined), delay),
  );
}

/** When LinkedIn's own save request was last seen (it names the post, a click may not). */
let lastSaveRequestAt = 0;
/** How long a Save/Unsave click waits for that request before acting on its own. */
const SAVE_REQUEST_WAIT_MS = 3_000;

/**
 * The post a control belongs to, where the page marks cards with their URN (the saved-posts
 * page: `data-chameleon-result-urn`). The 2026 feed doesn't; its save request names the post.
 */
function postUrnNear(element: Element): string | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    for (const attribute of node.attributes) {
      const urn = POST_URN.exec(attribute.value)?.[0];
      if (urn) return urn;
    }
  }
  return null;
}

/**
 * Save / Unsave clicks, a fallback for when LinkedIn's request isn't recognised. Read on
 * pointerdown (and Enter/Space), while the menu item is still on the page: LinkedIn closes
 * its menus, removing the item, before a click would arrive.
 */
function onControl(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest('button, a, [role="button"], [role="menuitem"], li');
  if (!(control instanceof HTMLElement)) return;
  const action =
    saveActionOfLabel(control.innerText) ??
    saveActionOfLabel(control.getAttribute('aria-label') ?? '');
  if (!action) return;
  const urn = postUrnNear(control);
  if (urn) {
    const shown = action === 'save' ? recent.get(urn) : undefined;
    if (shown) runner.saved([shown]);
    savedStateChanged(action, urn);
    return;
  }
  const pressedAt = Date.now();
  setTimeout(() => {
    if (lastSaveRequestAt < pressedAt) savedStateChanged(action, null);
  }, SAVE_REQUEST_WAIT_MS);
}

document.addEventListener('pointerdown', onControl, true);
document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Enter' || event.key === ' ') onControl(event);
  },
  true,
);

listenToTap(LINKEDIN_TAP_TAG, ({ op, status, requestBody, json }) => {
  if (status < 200 || status >= 300) return;

  if (op.startsWith('save-state:')) {
    // A request that changes something (it has a body), not one that only reads.
    if (requestBody === undefined) return;
    const change = saveChange(op, requestBody);
    if (!change) return;
    lastSaveRequestAt = Date.now();
    const shown = change.saved === true && change.urn ? recent.get(change.urn) : undefined;
    if (shown) runner.saved([shown]);
    savedStateChanged(
      change.saved === true ? 'save' : change.saved === false ? 'unsave' : null,
      change.urn,
    );
    return;
  }

  if (op.startsWith('saved-posts:')) {
    rememberAddress(op.slice('saved-posts:'.length));
    const page = parseSavedPostsPage(json);
    remember(page.posts);
    // Your own saved page, as you scroll it (sync sessions read the list themselves).
    void session.then((info) => {
      if (info.mode === 'passive' && onSavedPage() && page.posts.length > 0) {
        runner.listPage({ posts: page.posts, hasMore: true });
      }
    });
    return;
  }

  if (op === 'feed') remember(extractFeedPosts(json));
});
