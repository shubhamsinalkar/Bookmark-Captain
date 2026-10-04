import type { Platform } from '@bc/shared';
import type { SiteRecipe } from './sites/recipe';

/**
 * A post read from a platform page, before the background decides its `savedAt`
 * (which depends on whether the post was seen before; see background/platforms.ts).
 */
export interface CapturedPost {
  /** The platform's own id, e.g. a tweet id. Also the dedupe key on the server. */
  externalId: string;
  url: string;
  title?: string;
  author?: string;
  text?: string;
  thumbnailUrl?: string;
  /** When the post was published (not when it was saved). */
  postedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * - `full`: scroll the whole saved list (first connect, "Import all").
 * - `catch-up`: read from the top until reaching a post that is already synced.
 */
export type SyncMode = 'full' | 'catch-up';

/** How a sync session ended. */
export type SyncOutcome =
  | 'complete' // reached the end of the list
  | 'caught-up' // reached posts that were already synced
  | 'limit' // stopped at the safety cap
  | 'stopped' // the user stopped it or closed the tab
  | 'signed-out' // the platform showed a login page instead
  | 'no-response'; // the list never loaded

/** Where captured posts came from. */
export type CaptureVia =
  | 'sync' // a sync session the extension started
  | 'passive' // the user browsed their saved list themselves
  | 'live'; // the user just clicked Save/Bookmark

/** What the background tells a platform content script when it starts. */
export type SessionInfo =
  { mode: 'passive' } | { mode: SyncMode; visible: boolean; knownIds: string[] };

/** What the background tells the generic content script on a site the user taught it. */
export type SiteHello =
  | { mode: 'off' }
  /** Learning: read the page, propose a recipe, ask the user to confirm. */
  | { mode: 'learn'; platform: Platform; label: string }
  | {
      mode: 'sync';
      platform: Platform;
      label: string;
      listUrl: string;
      recipe: SiteRecipe;
      session: SessionInfo;
    };

/** Everything the background needs to know about one platform connector. */
export interface PlatformAdapter {
  platform: Platform;
  label: string;
  /** Origin the content scripts run on; messages from anywhere else are refused. */
  origin: string;
  /** Match patterns for the content scripts (also declared as host permissions). */
  matches: string[];
  /** The page listing the user's saved posts. */
  syncUrl: string;
  /** Bundles in the extension root: a main-world network tap and an isolated reader. */
  scripts: { main: string; content: string };
  /** Background catch-up interval in minutes, randomised within [min, max]. */
  catchUpMinutes: readonly [number, number];
  /** Taught by the user ("Sync this list") rather than built in. */
  learned?: boolean;
}
