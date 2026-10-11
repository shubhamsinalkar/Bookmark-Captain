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
/** The saved list's address, kept for pages that never load the list (the feed). */
const ADDRESS_STORAGE_KEY = 'linkedinSavedListAddress';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// TEMPORARY diagnostics for live unsave: remove once it is confirmed working on linkedin.com.
const debug = (...args: unknown[]) => console.warn('[Bookmark Captain · LinkedIn]', ...args);
debug('content script running on', window.location.pathname);

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
    debug('sync read a page', {
      ids: page.posts.map((post) => post.externalId),
      count: page.count,
      total: page.total,
      nextStart,
      reachedEnd,
    });
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
  debug(
    'saved list top after a save',
    page.posts.map((post) => post.externalId),
  );
  // Posts already in the inbox are only refreshed; new ones are dated now.
  runner.saved(page.posts);
}

/**
 * Something may have been saved or unsaved: read the saved list shortly (again if more
 * clicks follow). A save shows up at its top. An unsave can't be seen there (the post may
 * have been far down the list), so it asks the background to read the whole list again,
 * which removes whatever is gone; when the post is known, it is removed straight away too.
 */
function savedStateChanged(action: 'save' | 'unsave' | null, urn?: string) {
  debug('saved state changed', { action, urn: urn ?? '(unknown post)' });
  if (action !== 'save') {
    if (urn && action === 'unsave') runner.unsaved([urn]);
    runner.recheck();
  }
  if (action === 'unsave') return;
  for (const timer of checkTimers) clearTimeout(timer);
  checkTimers = LIVE_CHECK_DELAYS_MS.map((delay) =>
    setTimeout(() => void checkSavedList().catch(() => undefined), delay),
  );
}

/**
 * The post a control belongs to: LinkedIn marks each post's card with its URN
 * (`data-urn`, `data-id`, `data-chameleon-result-urn`, …), so look up through the parents.
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

/** The post whose ⋯ menu was opened last: its menu items may be drawn outside the card. */
let menuPost: { urn: string; at: number } | null = null;
const MENU_POST_TTL_MS = 60_000;

/**
 * Save / Unsave clicks, whatever request LinkedIn sends for them. Read on pointerdown (and
 * Enter/Space), while the menu item is still on the page: LinkedIn closes its menus, removing
 * the item, before a click would arrive.
 */
function onControl(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest('button, a, [role="button"], [role="menuitem"], li');
  if (!(control instanceof HTMLElement)) return;
  const urn = postUrnNear(control);
  const action =
    saveActionOfLabel(control.innerText) ??
    saveActionOfLabel(control.getAttribute('aria-label') ?? '');
  if (/sav/i.test(`${control.innerText} ${control.getAttribute('aria-label') ?? ''}`)) {
    debug('pressed', {
      text: control.innerText.slice(0, 80),
      label: control.getAttribute('aria-label'),
      action,
      urn,
    });
  }
  if (!action) {
    // Possibly a post's ⋯ button: remember which post its menu is for.
    if (urn) menuPost = { urn, at: Date.now() };
    return;
  }
  const fromMenu = menuPost && Date.now() - menuPost.at < MENU_POST_TTL_MS ? menuPost.urn : null;
  const post = urn ?? fromMenu ?? undefined;
  const shown = action === 'save' && post ? recent.get(post) : undefined;
  if (shown) runner.saved([shown]);
  savedStateChanged(action, post);
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
    debug('save-like request', { op, status, body: requestBody?.slice(0, 300) });
    // A request that changes something (it has a body), not one that only reads.
    if (requestBody === undefined) return;
    const change = saveChange(op, requestBody);
    const shown = change?.saved === true ? recent.get(change.urn) : undefined;
    if (shown) runner.saved([shown]);
    savedStateChanged(
      change?.saved === true ? 'save' : change?.saved === false ? 'unsave' : null,
      change?.urn,
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
