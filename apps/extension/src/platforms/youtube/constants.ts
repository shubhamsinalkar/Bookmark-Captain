/** Tag shared by the YouTube network tap and the YouTube content script. */
export const YOUTUBE_TAP_TAG = 'youtube';

export const YOUTUBE_ORIGIN = 'https://www.youtube.com';

/** "Watch later" is the playlist with the fixed id `WL`. */
export const WATCH_LATER_ID = 'WL';
export const WATCH_LATER_URL = `${YOUTUBE_ORIGIN}/playlist?list=${WATCH_LATER_ID}`;

/**
 * YouTube's web app loads data from its "InnerTube" API at `/youtubei/v1/<endpoint>`:
 *  - `browse/edit_playlist`: adding to or removing from a playlist, Watch later included;
 *  - `browse`: pages and their continuations (the Watch later list as you scroll it);
 *  - `next`, `get_watch`, `search`: watch pages and search results, read only to remember
 *    the title and channel of videos you might add to Watch later, and the Watch later
 *    entries in a watch page's playlist panel (removing one there sends only the entry).
 *    `get_watch` is the newer combined player + `next` request for a watch page.
 * A full page load embeds its first page in the HTML instead; the tap posts that as `initial`.
 */
export function youtubeOperation(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(parsed.hostname)) return null;
  const endpoint = /^\/youtubei\/v1\/([\w/]+)$/.exec(parsed.pathname)?.[1];
  switch (endpoint) {
    case 'browse/edit_playlist':
      return 'edit_playlist';
    case 'browse':
    case 'next':
    case 'search':
      return endpoint;
    case 'get_watch':
      return 'next';
    default:
      return null;
  }
}

export function isWatchLaterPage(): boolean {
  return (
    window.location.pathname === '/playlist' &&
    new URLSearchParams(window.location.search).get('list') === WATCH_LATER_ID
  );
}
