/** Tag shared by the LinkedIn network tap and the LinkedIn content script. */
export const LINKEDIN_TAP_TAG = 'linkedin';

export const LINKEDIN_ORIGIN = 'https://www.linkedin.com';

/** The page listing your saved posts. */
export const SAVED_POSTS_PATH = '/my-items/saved-posts/';
export const LINKEDIN_SAVED_URL = `${LINKEDIN_ORIGIN}${SAVED_POSTS_PATH}`;

/** The search intent LinkedIn's web app asks for when it loads the saved-posts list. */
export const SAVED_POSTS_INTENT = 'SEARCH_MY_ITEMS_SAVED_POSTS';

/** A post's URN: the id LinkedIn's feed, saved list and save requests all use. */
export const POST_URN = /urn:li:(?:activity|ugcPost|share):\d{5,25}/;

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * LinkedIn's web app loads everything from its Voyager API (`/voyager/api/…`). The requests
 * worth looking at:
 *  - `saved-posts:<path>`: a page of your saved posts. The address is kept (it carries the
 *    GraphQL query id, which changes with LinkedIn's deployments) so the content script can
 *    ask for the following pages the same way the page does;
 *  - `save-state:<urn>`: any request whose address mentions saving (`voyagerFeedDashSaveStates`,
 *    or whatever LinkedIn calls it next), from any part of the site. It is only a hint: the
 *    content script then reads the saved list itself, so a wrong guess here costs one read;
 *  - `feed`: feed and post responses, remembered so a Save click is sent with the post's
 *    content.
 */
export function linkedinOperation(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/.test(parsed.hostname)) return null;
  const address = decoded(`${parsed.pathname}${parsed.search}`);
  const api = parsed.pathname.startsWith('/voyager/api/');
  if (api && address.includes('SAVED_POSTS')) {
    return `saved-posts:${parsed.pathname}${parsed.search}`;
  }
  if (/save/i.test(address)) return `save-state:${POST_URN.exec(address)?.[0] ?? ''}`;
  if (api && /feed|update/i.test(address)) return 'feed';
  return null;
}
