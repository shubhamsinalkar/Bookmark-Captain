/**
 * Isolated content script on www.instagram.com (registered only while Instagram is
 * connected). Three ways a saved post reaches the inbox:
 *  - sync:    the background opened Instagram; the saved list is read page by page from
 *             Instagram's own API (`/api/v1/feed/saved/posts/`), no scrolling needed.
 *  - passive: you scroll your own saved page; whatever it loads is synced.
 *  - live:    you click Save (or remove it) on any post; the extension looks the post up
 *             and sends it straight away (or removes it).
 */
import { sendToBackground } from '../../messages';
import { createRunner } from '../runner';
import { listenToTap } from '../tap';
import type { SessionInfo } from '../types';
import { INSTAGRAM_TAP_TAG, SAVED_PATH, WEB_APP_ID } from './constants';
import {
  isFailedSave,
  isLoginRequired,
  parseSavedFeed,
  parseSavedState,
  saveRequest,
  type SaveRequest,
} from './parse';

/** Gives Instagram a moment to record a save before asking whether it happened. */
const LIVE_CHECK_DELAY_MS = 800;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SignedOutError extends Error {}

/** Same-origin API requests with your Instagram cookies, like the web app's own. */
async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { accept: 'application/json', 'x-ig-app-id': WEB_APP_ID },
  });
  const json: unknown = await response.json().catch(() => null);
  if (isLoginRequired(response.status, json)) throw new SignedOutError();
  if (!response.ok || json === null) throw new Error(`Instagram answered ${response.status}`);
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

const session: Promise<SessionInfo> = sendToBackground({
  type: 'platform:session',
  platform: 'instagram',
}).catch((): SessionInfo => ({ mode: 'passive' }));

let signedOut = false;
let nextMaxId: string | null = null;
let reachedEnd = false;
let loading: Promise<void> | null = null;

async function loadNextPage() {
  if (reachedEnd || signedOut) return;
  const params = new URLSearchParams(nextMaxId ? { max_id: nextMaxId } : {});
  try {
    const json = await withRetry(() => getJson(`/api/v1/feed/saved/posts/?${params}`));
    const page = parseSavedFeed(json);
    nextMaxId = page.nextMaxId;
    reachedEnd = nextMaxId === null;
    runner.listPage({ posts: page.posts, hasMore: !reachedEnd });
  } catch (error) {
    if (error instanceof SignedOutError) signedOut = true;
    throw error;
  }
}

const runner = createRunner({
  platform: 'instagram',
  label: 'Instagram',
  isListPage: () => !signedOut,
  session,
  // One page at a time, even if the runner asks again while a slow one is still loading.
  loadMore: () =>
    (loading ??= loadNextPage().finally(() => {
      loading = null;
    })),
});

/** A save request went through: look the posts up (media id → post), and pass them on. */
async function checkSaved({ ids, action }: SaveRequest) {
  await sleep(LIVE_CHECK_DELAY_MS);
  for (const id of ids) {
    // An id that isn't a post (Instagram answers with an error) mustn't stop the others.
    const json = await getJson(`/api/v1/media/${id}/info/`).catch(() => null);
    if (json === null) continue;
    const { saved, unsaved } = parseSavedState(json, action);
    runner.saved(saved);
    runner.unsaved(unsaved);
  }
}

listenToTap(INSTAGRAM_TAP_TAG, ({ op, status, requestBody, json }) => {
  if (status < 200 || status >= 300) return;
  // Your own saved page, as you scroll it (sync sessions read the list themselves).
  if (op === 'saved-feed') {
    const onSaved = SAVED_PATH.test(window.location.pathname);
    void session.then((info) => {
      if (info.mode === 'passive' && onSaved) {
        runner.listPage({ posts: parseSavedFeed(json).posts, hasMore: true });
      }
    });
    return;
  }
  const request = saveRequest(op, requestBody);
  if (request && !isFailedSave(json)) void checkSaved(request).catch(() => undefined);
});
