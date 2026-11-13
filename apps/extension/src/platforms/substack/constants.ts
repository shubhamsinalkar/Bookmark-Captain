/** Tag shared by the Substack network tap and the Substack content script. */
export const SUBSTACK_TAP_TAG = 'substack';

/** Your saved list lives here, whichever newsletter you saved from. */
export const SUBSTACK_ORIGIN = 'https://substack.com';

/** The Saved page: posts, notes and links (the Subscriptions tab's "Saved" has posts only). */
export const SUBSTACK_SAVED_URL = `${SUBSTACK_ORIGIN}/saved`;

/** `/saved` and its tabs (`/saved/notes`, …). */
export const SAVED_PATH = /^\/saved(?:\/|$)/;

/** A newsletter's own site, e.g. https://hnasr.substack.com. */
export const SUBSTACK_PUBLICATION_ORIGIN = /^https:\/\/[a-z0-9-]+\.substack\.com$/;

/**
 * The requests that save and unsave, checked against Substack on 2026-11-12:
 *  - a post: `POST` / `DELETE /api/v1/posts/saved` with `{"post_id": 123}`, on substack.com and
 *    on every newsletter's own site;
 *  - a note: `POST` / `DELETE /api/v1/note/c-123/save`, without a body.
 * Returns `post`, or `note:c-123` (the note named by the address). The content script only
 * takes these as a hint and reads the saved list to see what actually changed.
 */
export function substackOperation(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'substack.com' && !/^[a-z0-9-]+\.substack\.com$/.test(parsed.hostname)) {
    return null;
  }
  if (parsed.pathname === '/api/v1/posts/saved') return 'post';
  const note = /^\/api\/v1\/note\/(c-\d{1,20})\/save$/.exec(parsed.pathname);
  return note ? `note:${note[1]}` : null;
}
