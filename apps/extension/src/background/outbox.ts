import type { IngestItem, Platform } from '@bc/shared';
import { MAX_INGEST_BATCH } from '@bc/shared/constants';

/**
 * Changes waiting to be sent to the API. Persisted in chrome.storage so nothing is lost when
 * the service worker is suspended or the network is down; sent in order, oldest first.
 */
export type OutboxOp =
  | { kind: 'upsert'; items: IngestItem[] }
  /** Browser bookmarks, removed by URL. */
  | { kind: 'remove'; urls: string[] }
  /** Platform posts (e.g. an un-bookmarked tweet), removed by the platform's id. */
  | { kind: 'remove-ids'; platform: Platform; externalIds: string[] };

/**
 * Appends changes as API-sized operations. A change is merged into the last operation when
 * it is the same kind (and platform) and there is room, so a burst of single edits becomes
 * one request. Order across kinds is preserved (a remove never jumps ahead of an earlier
 * upsert).
 */
export function enqueue(outbox: OutboxOp[], op: OutboxOp): OutboxOp[] {
  switch (op.kind) {
    case 'upsert':
      return append(
        outbox,
        op.items,
        (last) => (last.kind === 'upsert' ? last.items : undefined),
        (items) => ({ kind: 'upsert', items }),
      );
    case 'remove':
      return append(
        outbox,
        op.urls,
        (last) => (last.kind === 'remove' ? last.urls : undefined),
        (urls) => ({ kind: 'remove', urls }),
      );
    case 'remove-ids':
      return append(
        outbox,
        op.externalIds,
        (last) =>
          last.kind === 'remove-ids' && last.platform === op.platform
            ? last.externalIds
            : undefined,
        (externalIds) => ({ kind: 'remove-ids', platform: op.platform, externalIds }),
      );
  }
}

function append<T>(
  outbox: OutboxOp[],
  values: T[],
  valuesOf: (op: OutboxOp) => T[] | undefined,
  make: (values: T[]) => OutboxOp,
): OutboxOp[] {
  if (values.length === 0) return outbox;

  const next = [...outbox];
  const last = next.at(-1);
  const lastValues = last && valuesOf(last);
  let remaining = values;

  if (lastValues && lastValues.length < MAX_INGEST_BATCH) {
    const room = MAX_INGEST_BATCH - lastValues.length;
    next[next.length - 1] = make([...lastValues, ...remaining.slice(0, room)]);
    remaining = remaining.slice(room);
  }
  for (let start = 0; start < remaining.length; start += MAX_INGEST_BATCH) {
    next.push(make(remaining.slice(start, start + MAX_INGEST_BATCH)));
  }
  return next;
}

/**
 * Removes the first `sentCount` values of the head operation after a successful send.
 * Not simply "drop the head": new changes may have been merged into it while the request
 * was in flight, and those were not sent. Merges only ever append, so the sent values are
 * exactly the first `sentCount`.
 */
export function acknowledge(outbox: OutboxOp[], sentCount: number): OutboxOp[] {
  const [head, ...rest] = outbox;
  if (!head) return outbox;
  const remainingHead: OutboxOp =
    head.kind === 'upsert'
      ? { kind: 'upsert', items: head.items.slice(sentCount) }
      : head.kind === 'remove'
        ? { kind: 'remove', urls: head.urls.slice(sentCount) }
        : { ...head, externalIds: head.externalIds.slice(sentCount) };
  return sizeOf(remainingHead) > 0 ? [remainingHead, ...rest] : rest;
}

export function sizeOf(op: OutboxOp): number {
  switch (op.kind) {
    case 'upsert':
      return op.items.length;
    case 'remove':
      return op.urls.length;
    case 'remove-ids':
      return op.externalIds.length;
  }
}

export function countPending(outbox: OutboxOp[]): number {
  return outbox.reduce((total, op) => total + sizeOf(op), 0);
}
