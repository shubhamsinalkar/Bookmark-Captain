import { describe, expect, it } from 'vitest';
import type { CapturedPost } from '../platforms/types';
import { type CaptureContext, capturedToItems, isCapturedPost, unlistedIds } from './capture';

describe('unlistedIds', () => {
  it('finds posts synced before that are no longer in the list', () => {
    expect(unlistedIds(['a', 'b', 'c'], ['c', 'a', 'new'])).toEqual(['b']);
    expect(unlistedIds(['a'], ['a'])).toEqual([]);
  });

  it('removes nothing when the list looks misread', () => {
    // Empty: a changed or failed page is likelier than a cleared-out list.
    expect(unlistedIds(['a', 'b'], [])).toEqual([]);
    // Losing most of a large list at once.
    const known = Array.from({ length: 50 }, (_, i) => `id${i}`);
    expect(unlistedIds(known, known.slice(0, 10))).toEqual([]);
    // Many removals are fine when most of the list is still there.
    const big = Array.from({ length: 100 }, (_, i) => `id${i}`);
    expect(unlistedIds(big, big.slice(0, 70))).toHaveLength(30);
  });
});

const NOW = Date.UTC(2026, 9, 1, 12);
const post = (id: string): CapturedPost => ({
  externalId: id,
  url: `https://x.com/a/status/${id}`,
  title: `Post ${id}`,
  postedAt: '2025-01-01T00:00:00.000Z',
});
const context = (overrides: Partial<CaptureContext> = {}): CaptureContext => ({
  known: new Set(),
  via: 'sync',
  fullImportDone: false,
  now: NOW,
  ...overrides,
});

describe('capturedToItems', () => {
  it('dates a first import by the posts themselves', () => {
    const { items, newIds } = capturedToItems('x', [post('1'), post('2')], context());
    expect(items.map((item) => item.savedAt)).toEqual([
      '2025-01-01T00:00:00.000Z',
      '2025-01-01T00:00:00.000Z',
    ]);
    expect(items[0]).toEqual({
      platform: 'x',
      externalId: '1',
      url: 'https://x.com/a/status/1',
      title: 'Post 1',
      savedAt: '2025-01-01T00:00:00.000Z',
    });
    expect(newIds).toEqual(['1', '2']);
  });

  it('dates new posts found after the full import as saved now, in list order', () => {
    const { items } = capturedToItems(
      'x',
      [post('3'), post('4')],
      context({ fullImportDone: true }),
    );
    expect(items.map((item) => item.savedAt)).toEqual([
      new Date(NOW).toISOString(),
      new Date(NOW - 1).toISOString(),
    ]);
  });

  it('dates a live save as now, even before the first import finished', () => {
    const { items } = capturedToItems('x', [post('5')], context({ via: 'live' }));
    expect(items[0]!.savedAt).toBe(new Date(NOW).toISOString());
  });

  it('leaves the date of already-sent posts alone', () => {
    const { items, newIds } = capturedToItems(
      'x',
      [post('1'), post('9')],
      context({
        known: new Set(['1']),
        fullImportDone: true,
      }),
    );
    expect(items[0]).not.toHaveProperty('savedAt');
    expect(items[1]!.savedAt).toBe(new Date(NOW - 1).toISOString());
    expect(newIds).toEqual(['9']);
  });
});

describe('isCapturedPost', () => {
  it('accepts well-formed posts and rejects anything else', () => {
    expect(isCapturedPost(post('1'))).toBe(true);
    expect(isCapturedPost({ ...post('1'), metadata: { handle: 'a' } })).toBe(true);
    expect(isCapturedPost({ ...post('1'), url: 'javascript:alert(1)' })).toBe(false);
    expect(isCapturedPost({ ...post('1'), externalId: '' })).toBe(false);
    expect(isCapturedPost({ ...post('1'), title: 42 })).toBe(false);
    expect(isCapturedPost({ ...post('1'), metadata: ['x'] })).toBe(false);
    expect(isCapturedPost(null)).toBe(false);
  });
});
