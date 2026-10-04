/** Tag shared by the generic site tap and the generic site content script. */
export const SITE_TAP_TAG = 'site';

/** The script bundles every learned site uses (one engine for all of them). */
export const SITE_SCRIPTS = { main: 'site-main.js', content: 'site-content.js' } as const;

/** A request's shape, for the learner's report: host and path with ids blanked out. */
export function requestShape(url: string): string {
  try {
    const { hostname, pathname } = new URL(url, window.location.href);
    const path = pathname
      .split('/')
      .map((segment) => (/\d{3,}|^[A-Za-z0-9_-]{16,}$/.test(segment) ? '*' : segment))
      .join('/');
    return `${hostname}${path}`;
  } catch {
    return 'unknown';
  }
}
