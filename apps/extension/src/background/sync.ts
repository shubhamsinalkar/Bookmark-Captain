import { api, ApiRequestError } from './api';
import {
  type BookmarkNode,
  collectIds,
  collectUrls,
  flattenTree,
  isSyncableUrl,
  toIngestItem,
} from './bookmarks';
import { acknowledge, countPending, enqueue, type OutboxOp, sizeOf } from './outbox';
import { type ExtensionState, readState, updateState } from './storage';
import type { SyncStatus } from '../messages';

export const RETRY_ALARM = 'bc-retry';
export const PERIODIC_ALARM = 'bc-periodic';
const RETRY_DELAY_MINUTES = 1;

let flushing: Promise<void> | null = null;
/** True while Chrome imports bookmarks from another browser (thousands of onCreated events). */
let importingFromBrowser = false;

// ── Sending ───────────────────────────────────────────────────────────────────

/** Sends queued changes, oldest first. Concurrent calls share one run. */
export function flush(): Promise<void> {
  flushing ??= runFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function runFlush(): Promise<void> {
  for (;;) {
    const { apiToken, outbox } = await readState();
    const op = outbox[0];
    if (!apiToken || !op) return;

    const sent = sizeOf(op);
    try {
      let notice: string | null = null;
      if (op.kind === 'upsert') {
        // The API saves what it can and lists the items it couldn't (e.g. an over-long URL).
        const { rejected } = await api.ingest(apiToken, op.items);
        if (rejected.length > 0) {
          const plural = rejected.length === 1 ? 'bookmark was' : 'bookmarks were';
          notice = `${rejected.length} ${plural} skipped: ${rejected[0]?.reason}`;
        }
      } else if (op.kind === 'remove') {
        await api.remove(apiToken, op.urls);
      } else {
        await api.removeIds(apiToken, op.platform, op.externalIds);
      }
      await updateState((state) => ({
        outbox: acknowledge(state.outbox, sent),
        lastSyncAt: new Date().toISOString(),
        lastError: notice,
      }));
    } catch (error) {
      const failure =
        error instanceof ApiRequestError ? error : new ApiRequestError(0, String(error));
      if (failure.status === 401) {
        await updateState(() => ({
          apiToken: null,
          lastError: 'Disconnected: the access key was revoked or expired. Connect again.',
        }));
        return;
      }
      if (failure.retryable) {
        await updateState(() => ({ lastError: failure.message }));
        await chrome.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_DELAY_MINUTES });
        return;
      }
      // Permanently rejected (e.g. invalid data): drop it so it can't block later changes.
      await updateState((state) => ({
        outbox: acknowledge(state.outbox, sent),
        lastError: `Some changes were rejected: ${failure.message}`,
      }));
    }
  }
}

/**
 * Queues a change and starts sending. `extra` applies further state changes in the same
 * atomic update (e.g. remembering which ids were queued).
 */
export async function queue(
  op: OutboxOp,
  extra: (state: ExtensionState) => Partial<ExtensionState> = () => ({}),
): Promise<void> {
  await updateState((state) => ({ ...extra(state), outbox: enqueue(state.outbox, op) }));
  void flush();
}

// ── Full import ───────────────────────────────────────────────────────────────

/** Queues every bookmark. Safe to repeat: the API upserts, so nothing is duplicated. */
export async function importAll(): Promise<void> {
  const { items, urlById } = flattenTree(await chrome.bookmarks.getTree());
  await queue({ kind: 'upsert', items }, () => ({ urlById }));
  await flush();
}

// ── Live changes ──────────────────────────────────────────────────────────────

async function folderPath(parentId: string | undefined): Promise<string[]> {
  const names: string[] = [];
  for (let id = parentId; id;) {
    const [node] = await chrome.bookmarks.get(id);
    if (!node) break;
    if (node.title) names.unshift(node.title);
    id = node.parentId;
  }
  return names;
}

/** Re-sends a node (and, for folders, everything inside) with its current folder path. */
async function resendSubtree(id: string): Promise<void> {
  const [node] = await chrome.bookmarks.getSubTree(id);
  if (!node) return;
  const { items, urlById } = flattenTree([node], await folderPath(node.parentId));
  await queue({ kind: 'upsert', items }, (state) => ({
    urlById: { ...state.urlById, ...urlById },
  }));
}

export async function handleCreated(id: string, node: BookmarkNode & { parentId?: string }) {
  if (importingFromBrowser || !isSyncableUrl(node.url)) return;
  const url = node.url;
  const item = toIngestItem({ ...node, url }, await folderPath(node.parentId));
  await queue({ kind: 'upsert', items: [item] }, (state) => ({
    urlById: { ...state.urlById, [id]: url },
  }));
}

export async function handleChanged(id: string) {
  const [node] = await chrome.bookmarks.get(id);
  if (!node) return;
  if (node.url === undefined) {
    // A folder was renamed: its bookmarks' folder paths changed.
    await resendSubtree(id);
    return;
  }

  const { urlById } = await readState();
  const previousUrl = urlById[id];
  if (
    previousUrl &&
    previousUrl !== node.url &&
    !isBookmarkedElsewhere(urlById, previousUrl, [id])
  ) {
    await queue({ kind: 'remove', urls: [previousUrl] });
  }
  if (isSyncableUrl(node.url)) {
    await resendSubtree(id);
  } else {
    await updateState((state) => ({ urlById: without(state.urlById, [id]) }));
  }
}

export async function handleMoved(id: string) {
  await resendSubtree(id);
}

export async function handleRemoved(node: BookmarkNode) {
  const ids = collectIds(node);
  const urls = collectUrls(node);
  await updateState((state) => {
    const urlById = without(state.urlById, ids);
    // The same URL may still be bookmarked in another folder; keep it in that case.
    const stillBookmarked = new Set(Object.values(urlById));
    const removed = urls.filter((url) => !stillBookmarked.has(url));
    return { urlById, outbox: enqueue(state.outbox, { kind: 'remove', urls: removed }) };
  });
  void flush();
}

export function handleImportBegan() {
  importingFromBrowser = true;
}

export async function handleImportEnded() {
  importingFromBrowser = false;
  await importAll();
}

function isBookmarkedElsewhere(urlById: Record<string, string>, url: string, ignoreIds: string[]) {
  return Object.entries(urlById).some(([id, value]) => value === url && !ignoreIds.includes(id));
}

function without(urlById: Record<string, string>, ids: string[]): Record<string, string> {
  const next = { ...urlById };
  for (const id of ids) delete next[id];
  return next;
}

// ── Connection ────────────────────────────────────────────────────────────────

export async function connect(token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api.me(token);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ApiRequestError && error.status === 401
          ? 'The access key was rejected.'
          : 'Could not reach Bookmark Captain.',
    };
  }

  const { apiToken: previous } = await readState();
  if (previous && previous !== token) {
    // Reconnecting: retire the old key so it doesn't linger as a live credential.
    await api.revokeCurrentToken(previous).catch(() => undefined);
  }
  await updateState(() => ({ apiToken: token, lastError: null }));
  void importAll();
  return { ok: true };
}

export async function disconnect(): Promise<void> {
  const { apiToken } = await readState();
  if (apiToken) await api.revokeCurrentToken(apiToken).catch(() => undefined);
  await updateState(() => ({ apiToken: null, outbox: [], lastSyncAt: null, lastError: null }));
}

export async function getStatus(): Promise<Omit<SyncStatus, 'platforms'>> {
  const state = await readState();
  return {
    connected: state.apiToken !== null,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    pendingChanges: countPending(state.outbox),
    syncing: flushing !== null,
  };
}
