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

  it('maps every newsletter on substack.com to Substack', () => {
    expect(platformForHost('substack.com')).toBe('substack');
    expect(platformForHost('hnasr.substack.com')).toBe('substack');
    // Only direct subdomains: a deeper or look-alike host is just a site.
    expect(platformForHost('a.b.substack.com')).toBe('a.b.substack.com');
    expect(platformForHost('notsubstack.com')).toBe('notsubstack.com');
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

  it("turns a known platform's own domain into that platform", () => {
    expect(platformSchema.parse('substack.com')).toBe('substack');
    expect(platformSchema.parse('hnasr.substack.com')).toBe('substack');
    expect(platformSchema.parse('x.com')).toBe('x');
    expect(platformSchema.parse('substack')).toBe('substack');
    // Other sites keep their exact id, prefix and all.
    expect(platformSchema.parse('www.pinterest.com')).toBe('www.pinterest.com');
  });

  it('labels known platforms by name and other sites by domain', () => {
    expect(platformLabel('linkedin')).toBe('LinkedIn');
    expect(platformLabel('pinterest.com')).toBe('pinterest.com');
  });
});
