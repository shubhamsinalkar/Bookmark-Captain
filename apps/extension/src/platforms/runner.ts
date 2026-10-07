import type { Platform } from '@bc/shared';
import { sendToBackground } from '../messages';
import { createOverlay, type Overlay } from './overlay';
import type { CapturedPost, SessionInfo, SyncOutcome } from './types';

/**
 * The platform-independent half of a content script: it asks the background whether this
 * tab is a sync session, forwards what the adapter reads, and (in a session) scrolls the
 * saved list, or asks the adapter for the next page (`loadMore`), until it reaches the end
 * or posts that were already synced.
 *
 * A platform adapter only has to feed it pages (`listPage`) and single saves/unsaves.
 */

const FIRST_PAGE_TIMEOUT_MS = 25_000;
const NEXT_PAGE_TIMEOUT_MS = 8_000;
/** Scrolls in a row that load nothing before we treat the list as finished. */
const MAX_IDLE_SCROLLS = 3;
/** Safety cap for one session. */
const MAX_POSTS = 5_000;

const numberFormat = new Intl.NumberFormat('en');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Human-ish pacing between scrolls, so a sync never hammers the site. */
const pause = () => sleep(1_200 + Math.random() * 1_300);

export interface ListPage {
  posts: CapturedPost[];
  hasMore: boolean;
  /** The site itself said the saved list is empty (see `readWholeList`). */
  empty?: boolean;
}

export interface RunnerOptions {
  platform: Platform;
  label: string;
  /** False when the site showed something else, e.g. a login page. */
  isListPage: () => boolean;
  /** The session, when the caller already has it; otherwise the runner asks the background. */
  session?: Promise<SessionInfo>;
  /**
   * For sites whose saved list can be fetched page by page: load the next page (and pass it
   * to `listPage`) instead of scrolling. Also loads the first page of a session.
   */
  loadMore?: () => Promise<void>;
  /**
   * Catch-ups keep reading past posts that were already synced: for lists where a new save
   * may land anywhere, not only at the top (YouTube's Watch Later). A session that reads the
   * list to its end also reports every post in it, so posts no longer listed are removed.
   * An empty list removes everything only when a page said so (`ListPage.empty`).
   */
  readWholeList?: boolean;
}

export interface PlatformRunner {
  /** A page of the saved list arrived (whether we scrolled or the user did). */
  listPage(page: ListPage): void;
  /** The user just saved these posts. */
  saved(posts: CapturedPost[]): void;
  /** The user just unsaved these posts. */
  unsaved(externalIds: string[]): void;
  /** The user just unsaved posts that can't be named: read the saved list again soon. */
  recheck(): void;
}

export function createRunner({
  platform,
  label,
  isListPage,
  session: givenSession,
  loadMore,
  readWholeList = false,
}: RunnerOptions): PlatformRunner {
  const seen = new Set<string>();
  let known = new Set<string>();
  let found = 0;
  let pagesLoaded = 0;
  let reachedEnd = false;
  let reachedKnown = false;
  let saidEmpty = false;
  let stopped = false;
  let wake: (() => void) | null = null;

  const session: Promise<SessionInfo> = (
    givenSession ?? sendToBackground({ type: 'platform:session', platform })
  )
    .then((info) => {
      if (info.mode !== 'passive') known = new Set(info.knownIds);
      return info;
    })
    .catch((): SessionInfo => ({ mode: 'passive' }));

  void session.then((info) => {
    if (info.mode !== 'passive') void runSession(info.mode, info.visible);
  });

  /** Resolves true when a page arrives after `since`, false after `timeoutMs`. */
  async function nextPage(since: number, timeoutMs: number): Promise<boolean> {
    if (pagesLoaded > since) return true;
    await Promise.race([new Promise<void>((resolve) => (wake = resolve)), sleep(timeoutMs)]);
    wake = null;
    return pagesLoaded > since;
  }

  async function runSession(mode: 'full' | 'catch-up', visible: boolean) {
    let overlay: Overlay | null = null;
    const showOverlay = () => {
      if (!visible || overlay) return;
      overlay = createOverlay(`Bookmark Captain · ${label}`);
      overlay.setAction({ label: 'Stop', onClick: () => (stopped = true) });
    };
    const progress = () =>
      overlay?.update(
        `${mode === 'full' ? 'Importing' : 'Checking'} your saved posts… ${numberFormat.format(found)} found`,
      );

    const finish = async (outcome: SyncOutcome) => {
      // Only a list the site itself said was finished counts as complete: running out of
      // things to scroll in a background tab doesn't prove the end was reached.
      const listedIds =
        readWholeList && reachedEnd && outcome === 'complete' ? [...seen] : undefined;
      await sendToBackground({
        type: 'platform:done',
        platform,
        outcome,
        found,
        ...(listedIds && { listedIds }),
        ...(listedIds?.length === 0 && saidEmpty && { listEmpty: true }),
      }).catch(() => undefined);
      showOverlay();
      overlay?.finish(summary(outcome, found, label), {
        label: 'Close tab',
        onClick: () => void sendToBackground({ type: 'platform:close-tab', platform }),
      });
    };

    void loadMore?.().catch(() => undefined);
    if (!(await nextPage(0, FIRST_PAGE_TIMEOUT_MS))) {
      return finish(isListPage() ? 'no-response' : 'signed-out');
    }
    showOverlay();
    progress();

    let idle = 0;
    for (;;) {
      if (stopped) return finish('stopped');
      if (reachedEnd) return finish('complete');
      if (mode === 'catch-up' && reachedKnown && !readWholeList) return finish('caught-up');
      if (found >= MAX_POSTS) return finish('limit');

      await pause();
      const before = pagesLoaded;
      if (loadMore) void loadMore().catch(() => undefined);
      else window.scrollTo({ top: document.documentElement.scrollHeight });
      if (await nextPage(before, NEXT_PAGE_TIMEOUT_MS)) {
        idle = 0;
        progress();
        void sendToBackground({ type: 'platform:progress', platform, found }).catch(
          () => undefined,
        );
      } else if (++idle >= MAX_IDLE_SCROLLS) {
        // Nothing more loads: the end of the list (or, in a background tab, as far as the
        // site will render without being looked at).
        return finish(mode === 'full' ? 'complete' : 'caught-up');
      }
    }
  }

  return {
    listPage(page) {
      void session.then((info) => {
        const fresh = page.posts.filter((post) => !seen.has(post.externalId));
        for (const post of fresh) seen.add(post.externalId);
        if (page.posts.some((post) => known.has(post.externalId))) reachedKnown = true;
        if (!page.hasMore) reachedEnd = true;
        if (page.empty) saidEmpty = true;
        found += fresh.length;
        pagesLoaded += 1;
        if (fresh.length > 0) {
          void sendToBackground({
            type: 'platform:captured',
            platform,
            posts: fresh,
            via: info.mode === 'passive' ? 'passive' : 'sync',
            // Where the unseen posts sit among the rest tells new saves from old ones.
            ...(fresh.length < page.posts.length && {
              pageIds: page.posts.map((post) => post.externalId),
            }),
          }).catch(() => undefined);
        }
        wake?.();
      });
    },
    saved(posts) {
      if (posts.length === 0) return;
      void sendToBackground({ type: 'platform:captured', platform, posts, via: 'live' }).catch(
        () => undefined,
      );
    },
    unsaved(externalIds) {
      if (externalIds.length === 0) return;
      void sendToBackground({ type: 'platform:removed', platform, externalIds }).catch(
        () => undefined,
      );
    },
    recheck() {
      void sendToBackground({ type: 'platform:recheck', platform }).catch(() => undefined);
    },
  };
}

function summary(outcome: SyncOutcome, found: number, label: string): string {
  const count = `${numberFormat.format(found)} saved post${found === 1 ? '' : 's'}`;
  switch (outcome) {
    case 'complete':
      return `Done. ${count} sent to your inbox.`;
    case 'caught-up':
      return `Up to date. Checked ${count}.`;
    case 'limit':
      return `Stopped at the limit of ${numberFormat.format(MAX_POSTS)}. ${count} sent.`;
    case 'stopped':
      return `Stopped. ${count} sent so far.`;
    case 'signed-out':
      return `Sign in to ${label} in this browser, then sync again.`;
    case 'no-response':
      return `${label} didn't load your saved posts. Reload this page to try again.`;
  }
}
