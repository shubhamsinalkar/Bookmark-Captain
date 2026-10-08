import { describe, expect, it } from 'vitest';
import { AiError } from './ai-error';
import { describeBookmark, type EnrichmentInput, normalize, parseEnrichment } from './enricher';

const input: EnrichmentInput = {
  platform: 'x',
  url: 'https://x.com/dbnerd/status/1',
  title: "Your Postgres index isn't being used? 7 reasons why 🧵",
  author: '@dbnerd',
  text: "Your Postgres index isn't being used? 7 reasons why 🧵 1/ Functions on the column…",
  metadata: { lang: 'en' },
  savedAt: new Date('2026-10-01T12:00:00Z'),
};

const output = {
  headline: 'Why Postgres ignores your index',
  summary: 'Seven reasons: functions on columns, implicit casts, stale statistics, …',
  topics: ['Postgres', '#databases', 'postgres', 'performance'],
  contentType: 'tutorial' as const,
  readMinutes: 4,
  shelfLife: 'evergreen' as const,
};

describe('describeBookmark', () => {
  it('lays out what was saved, skipping empty fields', () => {
    const text = describeBookmark({ ...input, author: null, metadata: {} });
    expect(text).toMatch(/^<bookmark>\nSource: X\nURL: https:\/\/x\.com/);
    expect(text).toContain('Saved: 2026-10-01');
    expect(text).toContain('Content:\nYour Postgres index');
    expect(text).not.toContain('Author:');
    expect(text).not.toContain('Metadata:');
  });

  it('clips long text and metadata when asked, and says so', () => {
    const text = describeBookmark(
      { ...input, text: 'a'.repeat(50), metadata: { note: 'b'.repeat(50) } },
      { maxTextChars: 10, maxMetadataChars: 12 },
    );
    expect(text).toContain(`Content:\n${'a'.repeat(10)}… [truncated]`);
    expect(text).toContain('Metadata: {"note":"bbb… [truncated]');
  });
});

describe('normalize', () => {
  it('cleans up topics and clamps values the schema cannot limit', () => {
    const result = normalize({
      ...output,
      headline: `  ${'a'.repeat(200)} `,
      topics: ['  System   Design ', '', 'x'.repeat(41), 'a', 'b', 'c', 'd', 'e'],
      readMinutes: 0,
    });
    expect(result.headline).toHaveLength(120);
    expect(result.headline.endsWith('…')).toBe(true);
    expect(result.topics).toEqual(['system design', 'a', 'b', 'c', 'd']);
    expect(result.readMinutes).toBe(1);
  });
});

describe('parseEnrichment', () => {
  it('validates and normalises a JSON answer', () => {
    expect(parseEnrichment(JSON.stringify(output))).toEqual({
      ...output,
      topics: ['postgres', 'databases', 'performance'],
    });
  });

  it.each([
    ['broken JSON', '{"headline":'],
    ['JSON that misses the schema', '{"headline": "x"}'],
    ['an unknown content type', JSON.stringify({ ...output, contentType: 'podcast' })],
  ])('rejects %s as an item failure', (_name, json) => {
    expect(() => parseEnrichment(json)).toThrow(AiError);
    expect(() => parseEnrichment(json)).toThrow(expect.objectContaining({ kind: 'item' }));
  });
});
