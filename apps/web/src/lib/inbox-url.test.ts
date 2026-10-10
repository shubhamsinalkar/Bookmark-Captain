import { describe, expect, it } from 'vitest';
import { inboxHref, looksLikeLink, parseInboxParams } from './inbox-url';

describe('parseInboxParams', () => {
  it('reads the view and source', () => {
    expect(parseInboxParams(new URLSearchParams('view=done&source=x'))).toEqual({
      view: 'done',
      source: 'x',
    });
    expect(parseInboxParams(new URLSearchParams('source=pinterest.com'))).toEqual({
      view: 'inbox',
      source: 'pinterest.com',
    });
  });

  it('falls back to the inbox for anything unrecognised', () => {
    expect(parseInboxParams(new URLSearchParams('view=nope&source=not a site'))).toEqual({
      view: 'inbox',
      source: undefined,
    });
    expect(parseInboxParams(new URLSearchParams())).toEqual({ view: 'inbox', source: undefined });
  });
});

describe('inboxHref', () => {
  it('leaves out defaults', () => {
    expect(inboxHref({ view: 'inbox' })).toBe('/inbox');
    expect(inboxHref({ view: 'done' })).toBe('/inbox?view=done');
    expect(inboxHref({ view: 'inbox', source: 'reddit' })).toBe('/inbox?source=reddit');
    expect(inboxHref({ view: 'all', source: 'x' })).toBe('/inbox?view=all&source=x');
  });
});

describe('looksLikeLink', () => {
  it.each([
    'example.com',
    'example.com/e2e-article?utm_source=newsletter',
    'https://www.example.com/e2e-article/',
    'http://localhost.test:3000/a',
    '  news.ycombinator.com/item?id=1  ',
  ])('treats %s as a link', (text) => {
    expect(looksLikeLink(text)).toBe(true);
  });

  it.each(['rust', 'rust ownership', 'next.js', 'node.js streams', 'v1.2', 'e.g. this', ''])(
    'treats %s as a search',
    (text) => {
      expect(looksLikeLink(text)).toBe(false);
    },
  );
});
