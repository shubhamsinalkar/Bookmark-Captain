import type { Platform } from '@bc/shared';
import type { SiteRecipe } from '../platforms/sites/recipe';
import type { OutboxOp } from './outbox';

/** A platform connection (e.g. X), kept by the extension because it does the syncing. */
export interface PlatformState {
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Once a full import has finished, unseen posts are new saves, dated "now". */
  fullImportDone: boolean;
}

export const DEFAULT_PLATFORM_STATE: PlatformState = {
  enabled: false,
  lastSyncAt: null,
  lastError: null,
  fullImportDone: false,
};

/** Everything the extension persists, in chrome.storage.local (never synced across devices). */
export interface ExtensionState {
  apiToken: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  outbox: OutboxOp[];
  /** Chrome bookmark id → URL, needed because onChanged doesn't report the previous URL. */
  urlById: Record<string, string>;
  platforms: Partial<Record<Platform, PlatformState>>;
  /** Ids of posts already sent per platform, newest first (capped). */
  knownIds: Partial<Record<Platform, string[]>>;
  /** Sites the user taught the extension with "Sync this list", by platform id. */
  sites: Partial<Record<Platform, LearnedSite>>;
}

/** A site connected by learning its saved page (no site-specific code). */
export interface LearnedSite {
  platform: Platform;
  label: string;
  /** The only origin its content scripts run on. */
  origin: string;
  /** The saved page the user pointed at; catch-ups reopen it. */
  listUrl: string;
  /** How to read the page; null until the user confirms the first preview. */
  recipe: SiteRecipe | null;
  /** True between "Sync this list" and the user's answer to the preview. */
  learning: boolean;
}

const DEFAULTS: ExtensionState = {
  apiToken: null,
  lastSyncAt: null,
  lastError: null,
  outbox: [],
  urlById: {},
  platforms: {},
  knownIds: {},
  sites: {},
};

export async function readState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...(stored as Partial<ExtensionState>) };
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Read-modify-write of the stored state, serialised: bookmark events can fire in quick
 * succession, and interleaved async updates would otherwise overwrite each other.
 */
export function updateState(
  update: (state: ExtensionState) => Partial<ExtensionState> | Promise<Partial<ExtensionState>>,
): Promise<ExtensionState> {
  const run = queue.then(async () => {
    const state = await readState();
    const changes = await update(state);
    await chrome.storage.local.set(changes);
    return { ...state, ...changes };
  });
  // Keep the chain alive even if one update fails.
  queue = run.catch(() => undefined);
  return run;
}

export function platformState(state: ExtensionState, platform: Platform): PlatformState {
  return { ...DEFAULT_PLATFORM_STATE, ...state.platforms[platform] };
}

/** A `platforms` change that updates one platform's entry. */
export function withPlatform(
  state: ExtensionState,
  platform: Platform,
  changes: Partial<PlatformState>,
): Pick<ExtensionState, 'platforms'> {
  return {
    platforms: {
      ...state.platforms,
      [platform]: { ...platformState(state, platform), ...changes },
    },
  };
}
