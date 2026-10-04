/** Tag shared by the Instagram network tap and the Instagram content script. */
export const INSTAGRAM_TAP_TAG = 'instagram';

export const INSTAGRAM_ORIGIN = 'https://www.instagram.com';

/**
 * Instagram's saved page needs your username in the address, which the extension doesn't
 * know, so sync sessions open the home page: the saved list is read through Instagram's
 * own API, whatever page is showing.
 */
export const INSTAGRAM_SYNC_URL = `${INSTAGRAM_ORIGIN}/`;

/** `/<username>/saved/…`, which is only ever your own. */
export const SAVED_PATH = /^\/[\w.]+\/saved(?:\/|$)/;

/** The id Instagram's web app sends with its API requests (`X-IG-App-ID`). */
export const WEB_APP_ID = '936619743392459';

/**
 * The requests worth looking at:
 *  - `saved-feed`: a page of your saved posts, as the web app loads it while you scroll;
 *  - `save:<media id>`: the web app's save/unsave endpoints (`/api/v1/web/save/<id>/save/`);
 *  - `graphql`: newer pages save through GraphQL mutations.
 * The content script decides from the request whether it was a save, then asks Instagram
 * whether the post is saved now, so a guess here can never add or remove the wrong post.
 */
export function instagramOperation(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/.test(parsed.hostname)) return null;
  const path = parsed.pathname;
  if (path.includes('/feed/saved/')) return 'saved-feed';
  const saved = /\/(\d{5,25})\/(?:un)?save\/?$/.exec(path);
  if (saved) return `save:${saved[1]}`;
  if (/^\/(api\/)?graphql/.test(path)) return 'graphql';
  return null;
}
