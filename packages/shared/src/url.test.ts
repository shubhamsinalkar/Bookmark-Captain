import { describe, expect, it } from 'vitest';
import { InvalidUrlError, normalizeUrl } from './url';

const canonical = (url: string) => normalizeUrl(url).canonicalUrl;

describe('normalizeUrl', () => {
  it('removes utm and click-id tracking parameters from both forms', () => {
    const result = normalizeUrl(
      'https://example.com/post?id=7&utm_source=x&utm_medium=social&fbclid=abc&gclid=def',
    );
    expect(result.url).toBe('https://example.com/post?id=7');
    expect(result.canonicalUrl).toBe('https://example.com/post?id=7');
  });

  it('keeps the original scheme, host and fragment in the display URL', () => {
    expect(normalizeUrl('http://www.Example.com/a/#section').url).toBe(
      'http://www.example.com/a/#section',
    );
  });

  it('canonicalises scheme, www, trailing slash, fragment and parameter order', () => {
    const variants = [
      'http://www.example.com/docs/?b=2&a=1#intro',
      'https://example.com/docs?a=1&b=2',
      'https://EXAMPLE.com:443/docs/?a=1&b=2&utm_campaign=z',
    ];
    expect(new Set(variants.map(canonical))).toEqual(new Set(['https://example.com/docs?a=1&b=2']));
  });

  it('treats twitter.com and x.com as the same post and drops share params', () => {
    expect(canonical('https://twitter.com/jack/status/20?s=20&t=abc')).toBe(
      'https://x.com/jack/status/20',
    );
    expect(canonical('https://mobile.twitter.com/jack/status/20')).toBe(
      'https://x.com/jack/status/20',
    );
  });

  it('maps youtu.be short links to the watch URL', () => {
    expect(canonical('https://youtu.be/dQw4w9WgXcQ?si=share123&t=42')).toBe(
      'https://youtube.com/watch?t=42&v=dQw4w9WgXcQ',
    );
    expect(canonical('https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share')).toBe(
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
    );
  });

  it('only strips site-specific params on that site', () => {
    expect(canonical('https://example.com/search?s=rust&t=1')).toBe(
      'https://example.com/search?s=rust&t=1',
    );
  });

  it('keeps hash routes used by single-page apps', () => {
    expect(canonical('https://app.example.com/#/projects/42')).toBe(
      'https://app.example.com/#/projects/42',
    );
  });

  it('removes credentials embedded in the URL', () => {
    expect(normalizeUrl('https://user:secret@example.com/x').url).toBe('https://example.com/x');
  });

  it('keeps the root path slash', () => {
    expect(canonical('https://example.com/')).toBe('https://example.com/');
  });

  it.each([
    ['not a url'],
    ['javascript:alert(1)'],
    ['chrome://settings'],
    ['file:///C:/secret.txt'],
    ['ftp://example.com/file'],
    ['http://intranet/page'],
  ])('rejects %s', (input) => {
    expect(() => normalizeUrl(input)).toThrow(InvalidUrlError);
  });
});
