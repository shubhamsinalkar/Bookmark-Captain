import type { Platform } from '@bc/shared';
import { INSTAGRAM_ORIGIN, INSTAGRAM_SYNC_URL } from './instagram/constants';
import { LINKEDIN_ORIGIN, LINKEDIN_SAVED_URL } from './linkedin/constants';
import { REDDIT_ORIGIN, REDDIT_SAVED_URL } from './reddit/constants';
import type { PlatformAdapter } from './types';
import { WATCH_LATER_URL, YOUTUBE_ORIGIN } from './youtube/constants';

/**
 * Every platform the extension can sync by reading the user's own signed-in pages.
 * Adding one (GitHub, …) means: a parser, a `main.ts` tap entry and a
 * `content.ts` reader under platforms/<name>/, the two bundles in scripts/build.ts, its
 * host in the manifest, and an entry here. Scheduling, sessions, the outbox, the popup and
 * the web app's Platforms card all work from this list.
 */
export const ADAPTERS: readonly PlatformAdapter[] = [
  {
    platform: 'x',
    label: 'X',
    origin: 'https://x.com',
    matches: ['https://x.com/*'],
    syncUrl: 'https://x.com/i/bookmarks',
    scripts: { main: 'x-main.js', content: 'x-content.js' },
    catchUpMinutes: [30, 60],
  },
  {
    platform: 'reddit',
    label: 'Reddit',
    origin: REDDIT_ORIGIN,
    matches: [`${REDDIT_ORIGIN}/*`],
    syncUrl: REDDIT_SAVED_URL,
    scripts: { main: 'reddit-main.js', content: 'reddit-content.js' },
    catchUpMinutes: [30, 60],
  },
  {
    platform: 'instagram',
    label: 'Instagram',
    origin: INSTAGRAM_ORIGIN,
    matches: [`${INSTAGRAM_ORIGIN}/*`],
    syncUrl: INSTAGRAM_SYNC_URL,
    scripts: { main: 'instagram-main.js', content: 'instagram-content.js' },
    catchUpMinutes: [30, 60],
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn',
    origin: LINKEDIN_ORIGIN,
    matches: [`${LINKEDIN_ORIGIN}/*`],
    syncUrl: LINKEDIN_SAVED_URL,
    scripts: { main: 'linkedin-main.js', content: 'linkedin-content.js' },
    catchUpMinutes: [30, 60],
  },
  {
    platform: 'youtube',
    label: 'YouTube',
    origin: YOUTUBE_ORIGIN,
    matches: [`${YOUTUBE_ORIGIN}/*`],
    syncUrl: WATCH_LATER_URL,
    scripts: { main: 'youtube-main.js', content: 'youtube-content.js' },
    catchUpMinutes: [30, 60],
  },
];

export function findAdapter(platform: Platform): PlatformAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.platform === platform);
}

/** Host permissions the manifest must declare for the adapters' content scripts. */
export const ADAPTER_HOST_PERMISSIONS = ADAPTERS.flatMap((adapter) => adapter.matches);
