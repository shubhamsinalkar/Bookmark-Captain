import { CONNECT_PAGE_URL, WEB_URL } from '../config';
import { PLATFORM_PAGE_REQUESTS, type RuntimeRequest } from '../messages';
import type { SyncOutcome } from '../platforms/types';
import {
  confirmSite,
  connectorForOrigin,
  connectPlatform,
  disconnectAllPlatforms,
  disconnectPlatform,
  getPlatformStatuses,
  handleCaptured,
  handleDone,
  handlePlatformAlarm,
  handleProgress,
  handleRemoved,
  handleTabRemoved,
  learnSite,
  rejectSite,
  requestRecheck,
  restorePlatforms,
  sessionFor,
  siteHello,
  syncPlatform,
} from './platforms';
import {
  connect,
  disconnect,
  flush,
  getStatus,
  handleChanged,
  handleCreated,
  handleImportBegan,
  handleImportEnded,
  handleMoved,
  handleRemoved as handleBookmarkRemoved,
  importAll,
  PERIODIC_ALARM,
  RETRY_ALARM,
} from './sync';

// MV3 service workers are suspended when idle: every listener must be registered
// synchronously at the top level so Chrome can wake the worker for the event.

function logFailure(context: string) {
  return (error: unknown) => console.error(`[bookmark-captain] ${context} failed`, error);
}

chrome.runtime.onInstalled.addListener(() => {
  // Safety net: retry anything still queued even if no new events arrive.
  void chrome.alarms.create(PERIODIC_ALARM, { periodInMinutes: 30 });
  flush().catch(logFailure('flush'));
  restorePlatforms().catch(logFailure('restore platforms'));
});
chrome.runtime.onStartup.addListener(() => {
  flush().catch(logFailure('flush'));
  restorePlatforms().catch(logFailure('restore platforms'));
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RETRY_ALARM || alarm.name === PERIODIC_ALARM) {
    flush().catch(logFailure('flush'));
  } else {
    handlePlatformAlarm(alarm.name);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  handleTabRemoved(tabId).catch(logFailure('end sync session'));
});

// "Sync this list" asks for access to the site from the popup. Chrome may close the popup
// while the prompt shows, so also start learning here when access to the open tab's site
// is granted. (learnSite ignores a second start for the same tab.)
chrome.permissions.onAdded.addListener((permissions) => {
  void (async () => {
    const origins = new Set(
      (permissions.origins ?? []).map((pattern) => pattern.replace(/\/\*$/, '')),
    );
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined || !tab.url) return;
    if (origins.has(new URL(tab.url).origin)) await learnSite(tab.id, tab.url);
  })().catch(logFailure('start learning'));
});

chrome.bookmarks.onCreated.addListener((id, node) => {
  handleCreated(id, node).catch(logFailure('sync created bookmark'));
});
chrome.bookmarks.onChanged.addListener((id) => {
  handleChanged(id).catch(logFailure('sync changed bookmark'));
});
chrome.bookmarks.onMoved.addListener((id) => {
  handleMoved(id).catch(logFailure('sync moved bookmark'));
});
chrome.bookmarks.onRemoved.addListener((_id, info) => {
  handleBookmarkRemoved(info.node).catch(logFailure('sync removed bookmark'));
});
chrome.bookmarks.onImportBegan.addListener(handleImportBegan);
chrome.bookmarks.onImportEnded.addListener(() => {
  handleImportEnded().catch(logFailure('sync imported bookmarks'));
});

const WEB_ORIGIN = new URL(WEB_URL).origin;
const EXTENSION_PAGES = chrome.runtime.getURL('');
const OUTCOMES = new Set<SyncOutcome>([
  'complete',
  'caught-up',
  'limit',
  'stopped',
  'signed-out',
  'no-response',
]);

/**
 * Who may send what:
 *  - `connect` hands over a credential: only the web app's connect page.
 *  - Platform page messages (captured posts, sessions, learned recipes): only from a tab on
 *    that connector's own site, i.e. our content script running there.
 *  - `site:learn` starts reading a new site: only the extension's popup.
 *  - Everything else (status, sync, connect/disconnect a platform): the popup and the web
 *    app, never a platform page.
 */
async function isTrustedSender(message: RuntimeRequest, sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id) return false;
  const fromExtensionPage = sender.url?.startsWith(EXTENSION_PAGES) ?? false;
  if (PLATFORM_PAGE_REQUESTS.has(message.type)) {
    if (sender.tab === undefined) return false;
    const connector = await connectorForOrigin(sender.origin);
    if (!connector) return false;
    return !('platform' in message) || message.platform === connector.platform;
  }
  if (message.type === 'site:learn') return fromExtensionPage;
  const fromWebApp = sender.origin === WEB_ORIGIN;
  if (message.type === 'connect') {
    return fromWebApp && (sender.url?.startsWith(CONNECT_PAGE_URL) ?? false);
  }
  return fromWebApp || fromExtensionPage;
}

const ok = { ok: true } as const;

async function handleMessage(message: RuntimeRequest, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  switch (message.type) {
    case 'getStatus':
      return { ...(await getStatus()), platforms: await getPlatformStatuses() };
    case 'connect':
      return connect(message.token);
    case 'disconnect':
      await disconnect();
      await disconnectAllPlatforms();
      return ok;
    case 'syncNow':
      await importAll();
      return ok;
    case 'platform:connect':
      return connectPlatform(message.platform);
    case 'platform:disconnect':
      return disconnectPlatform(message.platform);
    case 'platform:sync':
      return syncPlatform(message.platform, message.mode === 'full' ? 'full' : 'catch-up');
    case 'platform:session':
      return sessionFor(message.platform, tabId);
    case 'platform:captured':
      await handleCaptured(
        message.platform,
        message.posts,
        message.via === 'live' || message.via === 'passive' ? message.via : 'sync',
        message.pageIds,
      );
      return ok;
    case 'platform:removed':
      await handleRemoved(message.platform, message.externalIds);
      return ok;
    case 'platform:recheck':
      await requestRecheck(message.platform);
      return ok;
    case 'platform:progress':
      await handleProgress(tabId);
      return ok;
    case 'platform:done':
      if (OUTCOMES.has(message.outcome)) {
        await handleDone(tabId, message.outcome, message.listedIds, message.listEmpty === true);
      }
      return ok;
    case 'platform:close-tab':
      if (tabId !== undefined) await chrome.tabs.remove(tabId);
      return ok;
    case 'site:learn':
      return learnSite(message.tabId, message.url);
    case 'site:hello':
      return siteHello(sender.origin, tabId);
    case 'site:confirm':
      return confirmSite(sender.origin, tabId, message.recipe);
    case 'site:reject':
      await rejectSite(sender.origin, tabId);
      return ok;
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeRequest, sender, sendResponse) => {
  void (async () => {
    if (!(await isTrustedSender(message, sender))) {
      sendResponse({ ok: false, error: 'Not allowed' });
      return;
    }
    sendResponse(await handleMessage(message, sender));
  })().catch((error: unknown) => {
    logFailure(message.type)(error);
    sendResponse({ ok: false, error: 'Something went wrong' });
  });
  return true; // Keeps the channel open for the async response.
});
