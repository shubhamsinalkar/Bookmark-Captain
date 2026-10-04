import { describe, expect, it } from 'vitest';
import { displayHost, displayUrl, formatRelativeTime, morningInDays, snippetFor } from './format';

describe('formatRelativeTime', () => {
  const now = new Date('2026-03-10T12:00:00Z');

  it.each([
    ['2026-03-10T11:59:30Z', 'just now'],
    ['2026-03-10T11:55:00Z', '5 minutes ago'],
    ['2026-03-09T12:00:00Z', 'yesterday'],
    ['2026-02-24T12:00:00Z', '2 weeks ago'],
    ['2026-03-10T15:00:00Z', 'in 3 hours'],
  ])('formats %s as "%s"', (date, expected) => {
    expect(formatRelativeTime(date, now)).toBe(expected);
  });
});

describe('displayHost', () => {
  it('strips www and falls back to the input', () => {
    expect(displayHost('https://www.example.com/a')).toBe('example.com');
    expect(displayHost('not a url')).toBe('not a url');
  });
});

describe('displayUrl', () => {
  it('shows host and decoded path without the query string', () => {
    expect(displayUrl('https://www.postgresql.org/docs/current/queries-with.html?x=1')).toBe(
      'postgresql.org/docs/current/queries-with.html',
    );
    expect(displayUrl('https://example.com/caf%C3%A9/')).toBe('example.com/café');
    expect(displayUrl('https://example.com/')).toBe('example.com');
  });
});

describe('snippetFor', () => {
  it('hides text the title already shows', () => {
    expect(snippetFor('Ship small changes.', 'Ship small changes.')).toBeNull();
    // Multi-line posts get a one-line (possibly shortened) title.
    expect(
      snippetFor('First line. Second line…', 'First line.\n\nSecond line that goes on'),
    ).toBeNull();
  });

  it('shows text that adds something', () => {
    expect(snippetFor('An article', 'A summary of it')).toBe('A summary of it');
    expect(snippetFor(null, 'Only text')).toBe('Only text');
    expect(snippetFor('Title', null)).toBeNull();
  });
});

describe('morningInDays', () => {
  it('returns 09:00 local time n days ahead', () => {
    const result = morningInDays(1, new Date(2026, 2, 10, 22, 30));
    expect(result).toEqual(new Date(2026, 2, 11, 9, 0, 0, 0));
  });
});
