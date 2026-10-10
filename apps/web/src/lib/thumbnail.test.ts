import { describe, expect, it } from 'vitest';
import { faviconUrl, hueFor, thumbnailFor } from './thumbnail';

const at = (url: string, thumbnailUrl: string | null = null) => thumbnailFor({ url, thumbnailUrl });

describe('thumbnailFor', () => {
  it('prefers the thumbnail the source sent', () => {
    expect(at('https://youtu.be/dQw4w9WgXcQ', 'https://example.com/a.jpg')).toBe(
      'https://example.com/a.jpg',
    );
  });

  it('derives YouTube thumbnails from every URL shape', () => {
    const expected = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
    expect(at('https://youtu.be/dQw4w9WgXcQ')).toBe(expected);
    expect(at('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe(expected);
    expect(at('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe(expected);
    expect(at('https://www.youtube.com/playlist?list=WL')).toBeNull();
    expect(at('https://youtu.be/not-an-id')).toBeNull();
  });

  it('uses the social card of GitHub repositories', () => {
    expect(at('https://github.com/vercel/next.js')).toBe(
      'https://opengraph.githubassets.com/1/vercel/next.js',
    );
    expect(at('https://github.com/vercel/next.js/tree/canary/docs')).toBe(
      'https://opengraph.githubassets.com/1/vercel/next.js',
    );
    expect(at('https://github.com/vercel')).toBeNull();
    expect(at('https://github.com/settings/profile')).toBeNull();
  });

  it('returns null for other links and invalid URLs', () => {
    expect(at('https://example.com/article')).toBeNull();
    expect(at('not a url')).toBeNull();
  });
});

describe('faviconUrl', () => {
  it('asks for the icon at the requested size', () => {
    expect(faviconUrl('naukri.com', 64)).toBe(
      'https://www.google.com/s2/favicons?domain=naukri.com&sz=64',
    );
  });
});

describe('hueFor', () => {
  it('is stable and within range', () => {
    expect(hueFor('github.com')).toBe(hueFor('github.com'));
    for (const text of ['', 'a', 'naukri.com', 'a-very-long-domain-name.example.org']) {
      const hue = hueFor(text);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
