/**
 * Isolated content script on www.youtube.com (registered only while YouTube is connected).
 * Your "bookmarks" here are the Watch later playlist. Three ways a video reaches the inbox:
 *  - sync:    the background opened Watch later; the runner scrolls it.
 *  - passive: you open Watch later yourself; whatever loads is synced.
 *  - live:    you add a video to Watch later anywhere on YouTube (the clock button, the
 *             menu, or the Save dialog); it is sent straight away, and removed again if
 *             you take it out.
 * A sync that reads Watch later to its end also removes videos that are no longer in it
 * (taken out on your phone, say).
 */
import { createRunner } from '../runner';
import { listenToTap } from '../tap';
import type { CapturedPost } from '../types';
import { isWatchLaterPage, YOUTUBE_TAP_TAG } from './constants';
import {
  browseRequestTarget,
  extractVideos,
  isSuccessfulEdit,
  parseOembed,
  parseWatchLaterEdit,
  parseWatchLaterPage,
} from './parse';

/** Whether the page showing is Watch later: set by the latest page request, not the address. */
let showingWatchLater = isWatchLaterPage();

/** Videos seen on this page, so a Watch later click can be saved with its title. */
const recent = new Map<string, CapturedPost>();
/** Watch later entry id → video id, for its own Remove button. */
const entries = new Map<string, string>();
const RECENT_LIMIT = 3_000;

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

/** A signed-out YouTube shows a "Sign in" link to Google accounts instead of your list. */
const signedOut = () =>
  document.querySelector('a[href^="https://accounts.google.com/ServiceLogin"]');

const runner = createRunner({
  platform: 'youtube',
  label: 'YouTube',
  isListPage: () => isWatchLaterPage() && !signedOut(),
  // New videos aren't always added at the top of Watch later.
  readWholeList: true,
});

/** Title and channel for a video added from a page we didn't read it from. */
async function postFor(videoId: string): Promise<CapturedPost> {
  const known = recent.get(videoId);
  if (known) return known;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const response = await fetch(`/oembed?url=${encodeURIComponent(watchUrl)}&format=json`);
    return parseOembed(videoId, response.ok ? await response.json() : null);
  } catch {
    return parseOembed(videoId, null);
  }
}

listenToTap(YOUTUBE_TAP_TAG, ({ op, status, json, requestBody }) => {
  if (op === 'edit_playlist') {
    const edit = parseWatchLaterEdit(requestBody);
    if (!edit || !isSuccessfulEdit(status, json)) return;
    void Promise.all(edit.added.map(postFor)).then((posts) => runner.saved(posts));
    const removed = [
      ...edit.removed,
      ...edit.removedEntries.flatMap((entry) => entries.get(entry) ?? []),
    ];
    runner.unsaved(removed);
    return;
  }

  if (status < 200 || status >= 300) return;
  let watchLaterData = false;
  let continuation = false;
  if (op === 'initial') {
    // A full page load: its embedded first page belongs to the address that loaded.
    showingWatchLater = isWatchLaterPage();
    watchLaterData = showingWatchLater;
  } else if (op === 'browse') {
    const target = browseRequestTarget(requestBody);
    if (target === 'watch-later' || target === 'other-page') {
      showingWatchLater = target === 'watch-later';
    }
    continuation = target === 'continuation';
    watchLaterData = target === 'watch-later' || (continuation && showingWatchLater);
  }

  if (watchLaterData) {
    const page = parseWatchLaterPage(json);
    // A continuation always brings videos; an empty one isn't the list (or its end).
    if (continuation && page.videos.length === 0) return;
    for (const { post, setVideoId } of page.videos) {
      if (setVideoId) entries.set(setVideoId, post.externalId);
    }
    remember(page.videos.map((video) => video.post));
    runner.listPage({
      posts: page.videos.map((video) => video.post),
      hasMore: page.hasMore,
      ...(page.empty && { empty: true }),
    });
  } else {
    remember(extractVideos(json).map((video) => video.post));
  }
});
