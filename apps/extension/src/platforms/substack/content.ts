/**
 * Isolated content script for Substack (registered only while Substack is connected).
 *
 * On substack.com, where your saved list lives, three ways a saved post or note reaches the
 * inbox:
 *  - sync:    the background opened your Saved page; the list is read page by page from
 *             Substack's JSON (`/api/v1/reader/saved`), no scrolling needed.
 *  - passive: you open your Saved page yourself; its first page is read.
 *  - live:    you click Save on a post or a note; the extension finds it at the top of your
 *             saved list and sends it straight away. Unsave makes it read the whole list again,
 *             which removes what is no longer in it.
 *
 * On a newsletter's own site (*.substack.com) the list can't be read (the browser won't let
 * that site fetch from substack.com), so a Save or Unsave there asks the background to read
 * the list again shortly, in a tab of its own.
 *
 * Posts and notes are read as two lists (`filter=posts`, `filter=notes`) rather than `all`:
 * a saved link makes Substack answer `all` (and `links`) with an error, the other two not.
 */
import { sendToBackground } from '../../messages';
import { createRunner } from '../runner';
import { listenToTap } from '../tap';
import type { SessionInfo } from '../types';
import { SAVED_PATH, SUBSTACK_ORIGIN, SUBSTACK_TAP_TAG } from './constants';
import { parseSavedPage, parseSaveRequest, type SavedPage, type SaveRequest } from './parse';

const LISTS = ['posts', 'notes'] as const;
type List = (typeof LISTS)[number];

const RETRY_DELAY_MS = 3_000;
/** Gives Substack a moment to record a save before looking for it. */
const LIVE_CHECK_DELAYS_MS = [800, 2_500];
/** Wait after an unsave, so a burst of them is one read of the list. */
const UNSAVE_SETTLE_MS = 1_500;
/** Between pages when reading the whole list outside a sync session. */
const PAGE_PAUSE_MS = 300;
/** Substack sends 12 items a page: 400 pages is far more than anyone saves. */
const MAX_PAGES = 400;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class SignedOutError extends Error {}

/** undefined until Substack answered; false when it said you are signed out. */
let signedIn: boolean | undefined;

/** Same-origin requests with your Substack cookies, like the page's own. */
async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });
  if (response.status === 401 || response.status === 403) {
    signedIn = false;
    throw new SignedOutError();
  }
  if (!response.ok) throw new Error(`Substack answered ${response.status}`);
  signedIn = true;
  return response.json();
}

/** One page of a saved list. An error is never taken for an empty list: it throws. */
async function readPage(list: List, cursor: string | null): Promise<SavedPage> {
  const params = new URLSearchParams({ filter: list });
  if (cursor) params.set('cursor', cursor);
  const load = async () => {
    const page = parseSavedPage(await getJson(`/api/v1/reader/saved?${params}`));
    if (!page) throw new Error('Substack answered with something other than the saved list');
    return page;
  };
  try {
    return await load();
  } catch (error) {
    if (error instanceof SignedOutError) throw error;
    await sleep(RETRY_DELAY_MS);
    return load();
  }
}

/** The next cursor, refusing one that would read the same page again. */
function nextCursorOf(page: SavedPage, current: string | null): string | null {
  if (page.nextCursor !== null && page.nextCursor === current) {
    throw new Error('Substack sent the same page again');
  }
  return page.nextCursor;
}

/** Every saved post and note, for spotting what was unsaved. */
async function readWholeList(): Promise<{ ids: string[]; itemCount: number }> {
  const ids: string[] = [];
  let itemCount = 0;
  for (const list of LISTS) {
    let cursor: string | null = null;
    for (let pages = 1; ; pages += 1) {
      const page = await readPage(list, cursor);
      ids.push(...page.posts.map((post) => post.externalId));
      itemCount += page.itemCount;
      cursor = nextCursorOf(page, cursor);
      if (cursor === null) break;
      if (pages >= MAX_PAGES) throw new Error('The saved list is longer than expected');
      await sleep(PAGE_PAUSE_MS);
    }
  }
  return { ids, itemCount };
}

function onNewsletterSite() {
  listenToTap(SUBSTACK_TAP_TAG, ({ op, method, status, requestBody }) => {
    if (status < 200 || status >= 300 || !parseSaveRequest(op, method, requestBody)) return;
    void sendToBackground({ type: 'platform:recheck', platform: 'substack' }).catch(
      () => undefined,
    );
  });
}

function onSubstack() {
  const session: Promise<SessionInfo> = sendToBackground({
    type: 'platform:session',
    platform: 'substack',
  }).catch((): SessionInfo => ({ mode: 'passive' }));

  // A sync reads the posts list, then the notes list, a page at a time.
  let listIndex = 0;
  let cursor: string | null = null;
  let itemsRead = 0;
  let loading: Promise<void> | null = null;

  async function loadNextPage() {
    const list = LISTS[listIndex];
    if (!list) return;
    const page = await readPage(list, cursor);
    itemsRead += page.itemCount;
    cursor = nextCursorOf(page, cursor);
    if (cursor === null) listIndex += 1;
    const end = listIndex >= LISTS.length;
    runner.listPage({
      posts: page.posts,
      hasMore: !end,
      ...(end && itemsRead === 0 && { empty: true }),
    });
  }

  const runner = createRunner({
    platform: 'substack',
    label: 'Substack',
    // Read once the first page is due: Substack answers 401 when you are signed out.
    isListPage: () => signedIn !== false,
    session,
    // One page at a time, even if the runner asks again while a slow one is still loading.
    loadMore: () =>
      (loading ??= loadNextPage().finally(() => {
        loading = null;
      })),
    // Every check reads both lists to the end, so posts unsaved elsewhere (the app, another
    // computer, a custom-domain newsletter) are removed too. It's a few small JSON requests.
    readWholeList: true,
  });

  // Browsing your own Saved page counts as a check: read the first page of each list.
  // Substack switches pages without a full load, so watch the address.
  void session.then((info) => {
    if (info.mode !== 'passive') return;
    let wasSaved = false;
    const check = () => {
      const onSaved = SAVED_PATH.test(window.location.pathname);
      if (onSaved && !wasSaved) {
        void (async () => {
          for (const list of LISTS) {
            const page = await readPage(list, null);
            runner.listPage({ posts: page.posts, hasMore: true });
          }
        })().catch(() => undefined);
      }
      wasSaved = onSaved;
    };
    check();
    setInterval(check, 1_500);
  });

  /** A save went through: find it at the top of its list and send it. */
  async function confirmSave({ list, key }: SaveRequest) {
    if (key) {
      for (const delay of LIVE_CHECK_DELAYS_MS) {
        await sleep(delay);
        const post = (await readPage(list, null)).posts.find((item) => item.externalId === key);
        if (post) return runner.saved([post]);
      }
    }
    // Not found (or not named): the background reads the whole list again soon.
    runner.recheck();
  }

  let unsaveTimer: ReturnType<typeof setTimeout> | undefined;

  /** An unsave went through: read the whole list again, which removes what left it. */
  function checkUnsaved() {
    clearTimeout(unsaveTimer);
    unsaveTimer = setTimeout(() => {
      readWholeList()
        .then(({ ids, itemCount }) => runner.listed(ids, itemCount === 0))
        .catch(() => runner.recheck());
    }, UNSAVE_SETTLE_MS);
  }

  listenToTap(SUBSTACK_TAP_TAG, ({ op, method, status, requestBody }) => {
    if (status < 200 || status >= 300) return;
    const request = parseSaveRequest(op, method, requestBody);
    if (request?.action === 'save') void confirmSave(request).catch(() => runner.recheck());
    else if (request?.action === 'unsave') checkUnsaved();
  });
}

if (window.location.origin === SUBSTACK_ORIGIN) onSubstack();
else onNewsletterSite();
