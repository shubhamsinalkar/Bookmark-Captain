/** Tag shared by the Reddit network tap and the Reddit content script. */
export const REDDIT_TAP_TAG = 'reddit';

export const REDDIT_ORIGIN = 'https://www.reddit.com';

/** Your own saved page (`/user/me` is Reddit's alias for whoever is signed in). */
export const REDDIT_SAVED_URL = `${REDDIT_ORIGIN}/user/me/saved/`;

/** `/user/<name>/saved`, which is only ever your own. */
export const SAVED_PATH = /^\/(?:user|u)\/[^/]+\/saved\/?$/i;

/**
 * The requests worth looking at for live saves. Reddit's web app saves through its GraphQL
 * endpoints (operation names change between redesigns) and older pages through
 * `/api/save` / `/api/unsave`. The content script decides from the request body whether it
 * was a save, then asks Reddit for the post's actual saved state, so a guess here can
 * never add or remove the wrong post.
 */
export function redditOperation(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return null;
  }
  if (!/(^|\.)reddit\.com$/.test(parsed.hostname)) return null;
  if (/save/i.test(parsed.pathname)) return 'save';
  if (/graphql/i.test(parsed.pathname) || /^gql(-fed)?\./.test(parsed.hostname)) return 'graphql';
  return null;
}
