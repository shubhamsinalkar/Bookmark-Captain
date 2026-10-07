import type { Platform } from '@bc/shared';
import type { PlatformSyncStatus } from '@bc/shared/constants';
import type {
  CapturedPost,
  CaptureVia,
  SessionInfo,
  SiteHello,
  SyncMode,
  SyncOutcome,
} from './platforms/types';

/** Messages sent to the background service worker via chrome.runtime.sendMessage. */
export type RuntimeRequest =
  // From the popup and the web app (via the bridge).
  | { type: 'getStatus' }
  | { type: 'syncNow' }
  | { type: 'disconnect' }
  | { type: 'connect'; token: string }
  | { type: 'platform:connect'; platform: Platform }
  | { type: 'platform:disconnect'; platform: Platform }
  | { type: 'platform:sync'; platform: Platform; mode: SyncMode }
  // From a platform's content script (e.g. on x.com).
  | { type: 'platform:session'; platform: Platform }
  | {
      type: 'platform:captured';
      platform: Platform;
      posts: CapturedPost[];
      via: CaptureVia;
      /** Every post on the page, in list order, when `posts` holds only the unseen ones. */
      pageIds?: string[];
    }
  | { type: 'platform:removed'; platform: Platform; externalIds: string[] }
  | { type: 'platform:recheck'; platform: Platform }
  | { type: 'platform:progress'; platform: Platform; found: number }
  | {
      type: 'platform:done';
      platform: Platform;
      outcome: SyncOutcome;
      found: number;
      /** Every post in the saved list, when it was read to its very end (`readWholeList`). */
      listedIds?: string[];
      /** `listedIds` is empty because the site said the list is, not because nothing was read. */
      listEmpty?: boolean;
    }
  | { type: 'platform:close-tab'; platform: Platform }
  // "Sync this list" on any site: from the popup…
  | { type: 'site:learn'; tabId: number; url: string }
  // …and from the generic content script on that site.
  | { type: 'site:hello' }
  | { type: 'site:confirm'; recipe: unknown }
  | { type: 'site:reject' };

/** Requests only a platform's own content script may send (checked against its origin). */
export const PLATFORM_PAGE_REQUESTS = new Set<RuntimeRequest['type']>([
  'platform:session',
  'platform:captured',
  'platform:removed',
  'platform:recheck',
  'platform:progress',
  'platform:done',
  'platform:close-tab',
  'site:hello',
  'site:confirm',
  'site:reject',
]);

export interface SyncStatus {
  connected: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Changes waiting to be sent (e.g. while offline). */
  pendingChanges: number;
  syncing: boolean;
  platforms: PlatformSyncStatus[];
}

export type ActionResult = { ok: true } | { ok: false; error: string };

export type RuntimeResponse<T extends RuntimeRequest['type']> = T extends 'getStatus'
  ? SyncStatus
  : T extends 'platform:session'
    ? SessionInfo
    : T extends 'site:hello'
      ? SiteHello
      : T extends 'site:confirm'
        ? SessionInfo | { ok: false; error: string }
        : ActionResult;

export function sendToBackground<T extends RuntimeRequest>(
  request: T,
): Promise<RuntimeResponse<T['type']>> {
  return chrome.runtime.sendMessage(request);
}
