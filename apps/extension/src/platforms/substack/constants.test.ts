import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUBSTACK_PUBLICATION_ORIGIN, substackOperation } from './constants';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('substackOperation', () => {
  it('recognises post and note saves, on substack.com and on newsletters', () => {
    vi.stubGlobal('window', { location: { href: 'https://hnasr.substack.com/p/a' } });
    expect(substackOperation('/api/v1/posts/saved')).toBe('post');
    expect(substackOperation('https://substack.com/api/v1/posts/saved')).toBe('post');
    expect(substackOperation('https://substack.com/api/v1/note/c-383394571/save')).toBe(
      'note:c-383394571',
    );
  });

  it('ignores other requests and other sites', () => {
    vi.stubGlobal('window', { location: { href: 'https://substack.com/home' } });
    expect(substackOperation('/api/v1/reader/saved?filter=all')).toBe(null);
    expect(substackOperation('/api/v1/posts/215463184/progress')).toBe(null);
    expect(substackOperation('https://evil.example/api/v1/posts/saved')).toBe(null);
    expect(substackOperation('https://substack.com.evil.example/api/v1/posts/saved')).toBe(null);
  });
});

describe('SUBSTACK_PUBLICATION_ORIGIN', () => {
  it('matches newsletter sites only', () => {
    expect(SUBSTACK_PUBLICATION_ORIGIN.test('https://hnasr.substack.com')).toBe(true);
    expect(SUBSTACK_PUBLICATION_ORIGIN.test('https://substack.com')).toBe(false);
    expect(SUBSTACK_PUBLICATION_ORIGIN.test('http://hnasr.substack.com')).toBe(false);
    expect(SUBSTACK_PUBLICATION_ORIGIN.test('https://hnasr.substack.com.evil.example')).toBe(false);
  });
});
