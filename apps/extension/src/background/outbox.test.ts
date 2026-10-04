import { MAX_INGEST_BATCH } from '@bc/shared/constants';
import { describe, expect, it } from 'vitest';
import { acknowledge, countPending, enqueue, type OutboxOp } from './outbox';

const item = (n: number) => ({ platform: 'browser' as const, url: `https://example.com/${n}` });
const items = (count: number, from = 0) => Array.from({ length: count }, (_, i) => item(from + i));

describe('enqueue', () => {
  it('merges consecutive changes of the same kind', () => {
    let outbox: OutboxOp[] = [];
    outbox = enqueue(outbox, { kind: 'upsert', items: [item(1)] });
    outbox = enqueue(outbox, { kind: 'upsert', items: [item(2)] });
    expect(outbox).toEqual([{ kind: 'upsert', items: [item(1), item(2)] }]);
  });

  it('keeps order across kinds', () => {
    let outbox: OutboxOp[] = [];
    outbox = enqueue(outbox, { kind: 'upsert', items: [item(1)] });
    outbox = enqueue(outbox, { kind: 'remove', urls: ['https://example.com/1'] });
    outbox = enqueue(outbox, { kind: 'upsert', items: [item(2)] });
    expect(outbox.map((op) => op.kind)).toEqual(['upsert', 'remove', 'upsert']);
  });

  it('splits large batches to the API limit', () => {
    const outbox = enqueue([{ kind: 'upsert', items: items(10) }], {
      kind: 'upsert',
      items: items(MAX_INGEST_BATCH + 5, 10),
    });
    expect(outbox.map((op) => (op.kind === 'upsert' ? op.items.length : 0))).toEqual([
      MAX_INGEST_BATCH,
      15,
    ]);
    expect(countPending(outbox)).toBe(MAX_INGEST_BATCH + 15);
  });

  it('ignores empty changes', () => {
    expect(enqueue([], { kind: 'remove', urls: [] })).toEqual([]);
  });

  it('merges platform removals only within the same platform', () => {
    let outbox: OutboxOp[] = [];
    outbox = enqueue(outbox, { kind: 'remove-ids', platform: 'x', externalIds: ['1'] });
    outbox = enqueue(outbox, { kind: 'remove-ids', platform: 'x', externalIds: ['2'] });
    outbox = enqueue(outbox, { kind: 'remove-ids', platform: 'reddit', externalIds: ['t3_a'] });
    expect(outbox).toEqual([
      { kind: 'remove-ids', platform: 'x', externalIds: ['1', '2'] },
      { kind: 'remove-ids', platform: 'reddit', externalIds: ['t3_a'] },
    ]);
    expect(countPending(outbox)).toBe(3);
  });
});

describe('acknowledge', () => {
  it('removes the sent head operation', () => {
    const outbox: OutboxOp[] = [
      { kind: 'upsert', items: [item(1)] },
      { kind: 'remove', urls: ['x'] },
    ];
    expect(acknowledge(outbox, 1)).toEqual([{ kind: 'remove', urls: ['x'] }]);
  });

  it('keeps values merged into the head while it was being sent', () => {
    // Sent 2 items; a third was merged in during the request.
    const outbox: OutboxOp[] = [{ kind: 'upsert', items: [item(1), item(2), item(3)] }];
    expect(acknowledge(outbox, 2)).toEqual([{ kind: 'upsert', items: [item(3)] }]);
  });

  it('keeps the platform of a partly sent removal', () => {
    const outbox: OutboxOp[] = [{ kind: 'remove-ids', platform: 'x', externalIds: ['1', '2'] }];
    expect(acknowledge(outbox, 1)).toEqual([
      { kind: 'remove-ids', platform: 'x', externalIds: ['2'] },
    ]);
  });

  it('is a no-op on an empty outbox', () => {
    expect(acknowledge([], 3)).toEqual([]);
  });
});
