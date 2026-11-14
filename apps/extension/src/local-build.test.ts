import { describe, expect, it } from 'vitest';
import { buildManifest } from '../scripts/manifest';
import { isLocalApi } from './local-build';

describe('local builds', () => {
  it('treats this machine and test hosts as local', () => {
    expect(isLocalApi('http://localhost:4000')).toBe(true);
    expect(isLocalApi('http://127.0.0.1:4100')).toBe(true);
    expect(isLocalApi('http://api.bookmark-captain.test')).toBe(true);
    expect(isLocalApi('https://api.bookmarkcaptain.me')).toBe(false);
  });

  it('names a local build differently from the released extension', () => {
    const local = buildManifest({
      version: '1.0.0',
      apiUrl: 'http://localhost:4000',
      webUrl: 'http://localhost:3000',
    });
    expect(local.name).toBe('Bookmark Captain – LOCAL (localhost)');
    expect(local.action.default_title).toBe('Bookmark Captain – LOCAL (localhost)');

    const released = buildManifest({
      version: '1.0.0',
      apiUrl: 'https://api.bookmarkcaptain.me',
      webUrl: 'https://app.bookmarkcaptain.me',
    });
    expect(released.name).toBe('Bookmark Captain');
  });
});
