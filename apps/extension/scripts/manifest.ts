import { ADAPTER_HOST_PERMISSIONS } from '../src/platforms/registry';

export const ICON_SIZES = [16, 32, 48, 128] as const;

/**
 * Chrome match patterns without a port match every port, and patterns may not always
 * accept one, so origins are reduced to scheme + host. (The background worker still checks
 * the exact web origin before trusting a message.)
 */
function matchOrigin(url: string): string {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}`;
}

export function buildManifest({
  version,
  apiUrl,
  webUrl,
  grantHosts = [],
}: {
  version: string;
  apiUrl: string;
  webUrl: string;
  /** Test builds only: sites granted up front, since a test can't click Chrome's prompt. */
  grantHosts?: string[];
}) {
  const icons = Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/icon-${size}.png`]));
  const web = matchOrigin(webUrl);

  return {
    manifest_version: 3,
    name: 'Bookmark Captain',
    version,
    description: 'Sync your browser bookmarks and saved posts into your Bookmark Captain inbox.',
    minimum_chrome_version: '116',
    // Least privilege: bookmarks to read, storage for the queue, alarms for retries and
    // catch-ups, scripting to add a platform's content scripts only once it is connected,
    // activeTab so the popup can offer "Sync this list" for the page you're on.
    permissions: ['bookmarks', 'storage', 'alarms', 'scripting', 'activeTab'],
    host_permissions: [
      `${matchOrigin(apiUrl)}/*`,
      ...ADAPTER_HOST_PERMISSIONS,
      ...grantHosts.map((host) => `${matchOrigin(host)}/*`),
    ],
    // Any other site is asked for one at a time, when you click "Sync this list" on it.
    optional_host_permissions: ['https://*/*'],
    background: { service_worker: 'background.js', type: 'module' },
    action: { default_title: 'Bookmark Captain', default_popup: 'popup.html', default_icon: icons },
    icons,
    content_scripts: [
      {
        matches: [`${web}/extension/connect*`, `${web}/settings*`],
        js: ['bridge.js'],
        run_at: 'document_start',
      },
    ],
  };
}
