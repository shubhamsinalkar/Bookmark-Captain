import { describe, expect, it } from 'vitest';
import { platformSchema } from './bookmarks';
import { isPlatformId, platformForHost, platformLabel } from './platforms';

describe('platformForHost', () => {
  it('maps known sites to their platform, whatever the subdomain prefix', () => {
    expect(platformForHost('www.instagram.com')).toBe('instagram');
    expect(platformForHost('m.youtube.com')).toBe('youtube');
    expect(platformForHost('twitter.com')).toBe('x');
    expect(platformForHost('WWW.LinkedIn.com')).toBe('linkedin');
  });

  it('uses the domain for any other site', () => {
    expect(platformForHost('www.pinterest.com')).toBe('pinterest.com');
    expect(platformForHost('news.ycombinator.com')).toBe('news.ycombinator.com');
  });
});

describe('platform ids', () => {
  it('accepts known platforms and domains', () => {
    expect(isPlatformId('x')).toBe(true);
    expect(isPlatformId('pinterest.com')).toBe(true);
    expect(isPlatformId('a.b.example')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPlatformId('myspace')).toBe(false);
    expect(isPlatformId('https://pinterest.com')).toBe(false);
    expect(isPlatformId('-bad.com')).toBe(false);
    expect(isPlatformId('')).toBe(false);
  });

  it('normalises case in the schema', () => {
    expect(platformSchema.parse(' Pinterest.COM ')).toBe('pinterest.com');
    expect(platformSchema.safeParse('not a site').success).toBe(false);
  });

  it('labels known platforms by name and other sites by domain', () => {
    expect(platformLabel('linkedin')).toBe('LinkedIn');
    expect(platformLabel('pinterest.com')).toBe('pinterest.com');
  });
});
