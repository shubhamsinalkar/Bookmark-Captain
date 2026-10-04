/**
 * Isolated content script on x.com (registered only while X is connected). Three ways a
 * bookmark reaches the inbox:
 *  - sync:    the background opened x.com/i/bookmarks; the runner scrolls it.
 *  - passive: you browse your own bookmarks page; whatever loads is synced.
 *  - live:    you click Bookmark on any post; it is sent straight away (and removed again
 *             if you un-bookmark it).
 */
import { createRunner } from '../runner';
import { listenToTap } from '../tap';
import type { CapturedPost } from '../types';
import { X_BOOKMARKS_PATH, X_TAP_TAG } from './constants';
import {
  bookmarkMutationTweetId,
  extractTweets,
  isSuccessfulResponse,
  minimalPost,
  parseBookmarksPage,
} from './parse';

/** Posts seen on this page, so a Bookmark click can be saved with its full content. */
const recent = new Map<string, CapturedPost>();
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

const runner = createRunner({
  platform: 'x',
  label: 'X',
  isListPage: () => window.location.pathname.startsWith(X_BOOKMARKS_PATH),
});

listenToTap(X_TAP_TAG, ({ op, status, json, requestBody }) => {
  if (op === 'CreateBookmark' || op === 'DeleteBookmark') {
    const id = bookmarkMutationTweetId(requestBody);
    if (!id || !isSuccessfulResponse(status, json)) return;
    if (op === 'CreateBookmark') runner.saved([recent.get(id) ?? minimalPost(id)]);
    else runner.unsaved([id]);
    return;
  }

  if (status < 200 || status >= 300) return;
  remember(extractTweets(json));
  if (op === 'Bookmarks') runner.listPage(parseBookmarksPage(json));
});
