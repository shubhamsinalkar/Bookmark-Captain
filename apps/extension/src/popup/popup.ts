import { type PlatformSyncStatus, platformForHost } from '@bc/shared/constants';
import { CONNECT_PAGE_URL, WEB_URL } from '../config';
import { type RuntimeRequest, sendToBackground, type SyncStatus } from '../messages';

const app = document.getElementById('app')!;
const numberFormat = new Intl.NumberFormat('en');
const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour');
  return relativeTime.format(Math.round(hours / 24), 'day');
}

/** Builds an element; text is always set via textContent, never parsed as HTML. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; onClick?: () => void } = {},
  ...children: HTMLElement[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.onClick) node.addEventListener('click', props.onClick);
  node.append(...children);
  return node;
}

function openTab(url: string) {
  void chrome.tabs.create({ url });
  window.close();
}

/** A button that shows `pendingLabel` while its request runs, then re-renders. */
function actionButton(
  label: string,
  pendingLabel: string,
  request: RuntimeRequest,
  className = '',
) {
  const button = el('button', { className, text: label });
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = pendingLabel;
    void chrome.runtime
      .sendMessage(request)
      .catch(() => undefined)
      .finally(() => void render());
  });
  return button;
}

function syncSummary(status: SyncStatus): string {
  if (status.syncing) return 'Syncing…';
  const pending =
    status.pendingChanges > 0
      ? `, ${numberFormat.format(status.pendingChanges)} waiting to sync`
      : '';
  return status.lastSyncAt
    ? `Last synced ${timeAgo(status.lastSyncAt)}${pending}`
    : `Not synced yet${pending}`;
}

function platformSummary(platform: PlatformSyncStatus): string {
  if (!platform.enabled) return 'Not connected';
  if (platform.syncing) return 'Syncing now…';
  const count = `${numberFormat.format(platform.itemsSynced)} posts`;
  return platform.lastSyncAt ? `${count}, checked ${timeAgo(platform.lastSyncAt)}` : count;
}

function platformRow(platform: PlatformSyncStatus): HTMLElement {
  const { platform: id, label } = platform;
  const actions = platform.enabled
    ? [
        actionButton('Sync now', 'Opening…', {
          type: 'platform:sync',
          platform: id,
          mode: 'catch-up',
        }),
        actionButton(
          'Disconnect',
          'Disconnecting…',
          { type: 'platform:disconnect', platform: id },
          'link',
        ),
      ]
    : [actionButton(`Connect ${label}`, 'Opening…', { type: 'platform:connect', platform: id })];

  return el(
    'li',
    { className: 'platform' },
    el(
      'div',
      {},
      el('strong', { text: label }),
      el('p', { className: 'muted', text: platformSummary(platform) }),
      ...(platform.lastError ? [el('p', { className: 'error', text: platform.lastError })] : []),
    ),
    el('div', { className: 'row-actions' }, ...actions),
  );
}

/** The tab the popup was opened over. (`?tab=<id>` lets automated tests choose one.) */
async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const param = new URLSearchParams(window.location.search).get('tab');
  if (param) return chrome.tabs.get(Number(param)).catch(() => undefined);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

/**
 * "Sync this list" for the page you're on, when its site isn't connected yet: asks Chrome
 * for access to just this site, then the extension learns the page and shows a preview.
 */
function siteSection(tab: chrome.tabs.Tab | undefined, status: SyncStatus): HTMLElement[] {
  if (!tab?.url || tab.id === undefined) return [];
  let url: URL;
  try {
    url = new URL(tab.url);
  } catch {
    return [];
  }
  if (url.protocol !== 'https:' || url.origin === new URL(WEB_URL).origin) return [];
  const platform = platformForHost(url.hostname);
  // Already connected, or built in (X): the Platforms list below has its buttons.
  if (status.platforms.some((p) => p.platform === platform && (p.enabled || !p.learned))) return [];

  const tabId = tab.id;
  const pageUrl = tab.url;
  const message = el('p', {
    className: 'muted',
    text: `Open the page that lists your saved posts on ${url.hostname.replace(/^www\./, '')}, then:`,
  });
  const button = el('button', { className: 'primary', text: 'Sync this list' });
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Asking for access…';
    // Must be called straight from the click, before any await.
    void chrome.permissions
      .request({ origins: [`${url.origin}/*`] })
      .then(async (granted) => {
        if (!granted)
          throw new Error('Bookmark Captain needs access to this site to read your list.');
        button.textContent = 'Reading the page…';
        const result = await sendToBackground({ type: 'site:learn', tabId, url: pageUrl });
        if (!result.ok) throw new Error(result.error);
        message.textContent = 'Check the page: a preview of what was found appears there.';
        button.remove();
      })
      .catch((error: unknown) => {
        message.className = 'error';
        message.textContent = error instanceof Error ? error.message : 'Something went wrong.';
        button.disabled = false;
        button.textContent = 'Sync this list';
      });
  });
  return [el('h2', { text: 'This site' }), message, el('div', { className: 'actions' }, button)];
}

async function render(): Promise<void> {
  const [status, tab] = await Promise.all([sendToBackground({ type: 'getStatus' }), currentTab()]);
  app.replaceChildren();

  if (!status.connected) {
    app.append(
      el('p', { text: 'Connect your account to sync your bookmarks into your inbox.' }),
      ...(status.lastError ? [el('p', { className: 'error', text: status.lastError })] : []),
      el(
        'div',
        { className: 'actions' },
        el('button', {
          className: 'primary',
          text: 'Connect account',
          onClick: () => openTab(CONNECT_PAGE_URL),
        }),
      ),
    );
    return;
  }

  app.append(
    el('p', { className: 'ok', text: '● Connected' }),
    el('p', { className: 'muted', text: `Browser bookmarks: ${syncSummary(status)}` }),
    ...(status.lastError ? [el('p', { className: 'error', text: status.lastError })] : []),
    ...siteSection(tab, status),
    el('h2', { text: 'Platforms' }),
    el('ul', { className: 'platforms' }, ...status.platforms.map(platformRow)),
    el(
      'div',
      { className: 'actions' },
      el('button', {
        className: 'primary',
        text: 'Open inbox',
        onClick: () => openTab(new URL('/inbox', WEB_URL).toString()),
      }),
      actionButton('Sync all bookmarks now', 'Syncing…', { type: 'syncNow' }),
      actionButton('Disconnect this browser', 'Disconnecting…', { type: 'disconnect' }, 'link'),
    ),
  );

  // Keep the summary live while work is in progress.
  const busy =
    status.syncing || status.pendingChanges > 0 || status.platforms.some((p) => p.syncing);
  if (busy) setTimeout(() => void render(), 1500);
}

void render();
