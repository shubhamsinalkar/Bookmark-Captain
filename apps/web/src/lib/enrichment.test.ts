import type { Bookmark, BookmarkEnrichment } from '@bc/shared';
import { describe, expect, it } from 'vitest';
import { cardText, formatMinutes } from './enrichment';

const done: BookmarkEnrichment = {
  status: 'done',
  headline: 'Why Postgres ignores your index',
  summary: 'Seven reasons: functions on columns, implicit casts, stale statistics, …',
  topics: ['postgres'],
  contentType: 'tutorial',
  readMinutes: 4,
  shelfLife: 'evergreen',
};

function bookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: '1',
    platform: 'x',
    externalId: '1',
    url: 'https://example.com/docs/indexes',
    canonicalUrl: 'https://example.com/docs/indexes',
    title: null,
    author: null,
    text: null,
    thumbnailUrl: null,
    metadata: {},
    status: 'unread',
    savedAt: '2026-10-01T00:00:00.000Z',
    snoozeUntil: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ai: null,
    ...overrides,
  };
}

const post = {
  title: "Your Postgres index isn't being used? 7 reasons why…",
  text: "Your Postgres index isn't being used? 7 reasons why 🧵 1/ Functions on the column",
};

describe('cardText', () => {
  it('shows the saved text as before when there is no enrichment', () => {
    expect(cardText(bookmark(post))).toEqual({ title: post.title, summary: null, original: null });
    expect(cardText(bookmark({ ai: { ...done, status: 'pending' }, ...post })).title).toBe(
      post.title,
    );
  });

  it('replaces a post’s opening words with the headline, keeping the post as the original', () => {
    expect(cardText(bookmark({ ai: done, ...post }))).toEqual({
      title: done.headline,
      summary: done.summary,
      original: post.text,
    });
  });

  it('keeps a real title and its body', () => {
    const article = { title: 'Indexes in depth', text: 'A long guide to B-tree internals.' };
    expect(cardText(bookmark({ ai: done, ...article }))).toEqual({
      title: 'Indexes in depth',
      summary: done.summary,
      original: article.text,
    });
  });

  it('gives untitled links the headline instead of their URL', () => {
    expect(cardText(bookmark({ ai: done })).title).toBe(done.headline);
    expect(cardText(bookmark({})).title).toBe('example.com/docs/indexes');
  });
});

describe('formatMinutes', () => {
  it.each([
    [4, '4 min'],
    [60, '1 h'],
    [80, '1 h 20 min'],
  ])('%i → %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });
});
