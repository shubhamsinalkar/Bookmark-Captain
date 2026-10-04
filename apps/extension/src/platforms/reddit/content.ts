/**
 * Isolated content script on www.reddit.com (registered only while Reddit is connected).
 * Three ways a saved post reaches the inbox:
 *  - sync:    the background opened your saved page; the saved list is read page by page
 *             from Reddit's JSON listing (`/user/<name>/saved.json`), no scrolling needed.
 *  - passive: you open your saved page yourself; its first page is read.
 *  - live:    you click Save (or Unsave) on any post or comment; the extension asks Reddit
 *             whether it is now saved and sends it straight away (or removes it).
 */
import { sendToBackground } from '../../messages';
import { createRunner } from '../runner';
import { listenToTap } from '../tap';
import type { SessionInfo } from '../types';
import { REDDIT_TAP_TAG, SAVED_PATH } from './constants';
import { parseSavedListing, parseSavedState, parseUsername, saveRequestIds } from './parse';

const PAGE_SIZE = 100;
/** Gives Reddit a moment to record a save before asking whether it happened. */
const LIVE_CHECK_DELAY_MS = 800;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Same-origin requests with your Reddit cookies, like the page's own. */
async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Reddit answered ${response.status}`);
  return response.json();
}

async function withRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    await sleep(RETRY_DELAY_MS);
    return load();
  }
}

/** undefined until checked; null when signed out. */
let username: string | null | undefined;

async function signedInUser(): Promise<string | null> {
  username ??= parseUsername(await withRetry(() => getJson('/api/me.json')));
  return username;
}

function savedPage(user: string, after: string | null) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), raw_json: '1' });
  if (after) params.set('after', after);
  return withRetry(() => getJson(`/user/${encodeURIComponent(user)}/saved.json?${params}`)).then(
    parseSavedListing,
  );
}

const session: Promise<SessionInfo> = sendToBackground({
  type: 'platform:session',
  platform: 'reddit',
}).catch((): SessionInfo => ({ mode: 'passive' }));

let after: string | null = null;
let reachedEnd = false;
let loading: Promise<void> | null = null;

async function loadNextPage() {
  if (reachedEnd) return;
  const user = await signedInUser();
  if (!user) return;
  const page = await savedPage(user, after);
  after = page.after;
  reachedEnd = after === null;
  runner.listPage({ posts: page.posts, hasMore: !reachedEnd });
}

const runner = createRunner({
  platform: 'reddit',
  label: 'Reddit',
  // Read once the first page is due: signed out means no name from /api/me.json.
  isListPage: () => username !== null,
  session,
  // One page at a time, even if the runner asks again while a slow one is still loading.
  loadMore: () =>
    (loading ??= loadNextPage().finally(() => {
      loading = null;
    })),
});

// Browsing your own saved page counts as a check: read its first page. Reddit's tabs switch
// without a full page load, so watch the address rather than only the initial one.
void session.then((info) => {
  if (info.mode !== 'passive') return;
  let wasSaved = false;
  const check = () => {
    const onSaved = SAVED_PATH.test(window.location.pathname);
    if (onSaved && !wasSaved) {
      void signedInUser()
        .then((user) => (user ? savedPage(user, null) : null))
        .then((page) => page && runner.listPage({ posts: page.posts, hasMore: true }))
        .catch(() => undefined);
    }
    wasSaved = onSaved;
  };
  check();
  setInterval(check, 1_500);
});

/** A save request went through: ask Reddit what is saved now, and pass that on. */
async function checkSaved(ids: string[]) {
  await sleep(LIVE_CHECK_DELAY_MS);
  const json = await getJson(`/api/info.json?id=${ids.join(',')}&raw_json=1`);
  const { saved, unsaved } = parseSavedState(json);
  runner.saved(saved);
  runner.unsaved(unsaved);
}

listenToTap(REDDIT_TAP_TAG, ({ op, status, requestBody }) => {
  if (status < 200 || status >= 300) return;
  const ids = saveRequestIds(op, requestBody);
  if (ids.length > 0) void checkSaved(ids).catch(() => undefined);
});
