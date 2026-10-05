import { type Platform, platformForHost, platformLabel } from '@bc/shared';
import type { PlatformSyncStatus } from '@bc/shared/constants';
import { WEB_URL } from '../config';
import type { ActionResult } from '../messages';
import { ADAPTERS } from '../platforms/registry';
import { SITE_SCRIPTS } from '../platforms/sites/constants';
import { isSiteRecipe } from '../platforms/sites/recipe';
import type {
  CaptureVia,
  PlatformAdapter,
  SessionInfo,
  SiteHello,
  SyncMode,
  SyncOutcome,
} from '../platforms/types';
import { capturedToItems, isCapturedPost, unlistedIds } from './capture';
import { enqueue } from './outbox';
import {
  DEFAULT_PLATFORM_STATE,
  type ExtensionState,
  type LearnedSite,
  platformState,
  readState,
  updateState,
  withPlatform,
} from './storage';
import { flush } from './sync';

/**
 * Connectors that read the user's own signed-in pages. Two kinds, one lifecycle:
 *  - built in (platforms/registry.ts, e.g. X), connected with "Connect X";
 *  - learned: any site, connected with "Sync this list" on its saved page. The learner
 *    writes a recipe, the user confirms a preview, and the generic site scripts run it.
 *
 * Connecting registers the content scripts (so the extension does nothing on a site until
 * you connect it) and imports the saved list in a visible tab. After that, new saves arrive
 * when you browse the list and from a background catch-up every 30–60 minutes that reads
 * the top of the list in an inactive tab and closes it again (plus live Save clicks on X).
 */

const SCRIPT_ID_PREFIX = 'platform:';
const CATCH_UP_ALARM_PREFIX = 'bc-catch-up:';
const TIMEOUT_ALARM_PREFIX = 'bc-sync-timeout:';
/** A session that reports nothing for this long is abandoned (e.g. the page never loaded). */
const SESSION_TIMEOUT_MINUTES = 2;
/** Skip a scheduled catch-up if the list was read this recently (e.g. you browsed it). */
const MIN_CATCH_UP_GAP_MS = 20 * 60_000;
const KNOWN_IDS_LIMIT = 5_000;
/** Enough to recognise "already synced" at the top of the list. */
const SESSION_KNOWN_IDS = 1_000;
const LEARNED_CATCH_UP_MINUTES = [30, 60] as const;

const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

// ── Connectors ───────────────────────────────────────────────────────────────────

function siteConnector(site: LearnedSite): PlatformAdapter {
  return {
    platform: site.platform,
    label: site.label,
    origin: site.origin,
    matches: [`${site.origin}/*`],
    syncUrl: site.listUrl,
    scripts: SITE_SCRIPTS,
    catchUpMinutes: LEARNED_CATCH_UP_MINUTES,
    learned: true,
  };
}

/** Sites taught with "Sync this list", except any that now have a built-in connector. */
const learnedSites = (state: ExtensionState): LearnedSite[] =>
  Object.values(state.sites).filter(
    (site): site is LearnedSite =>
      site !== undefined && !ADAPTERS.some((adapter) => adapter.platform === site.platform),
  );

/** Every connector: built in, then learned. */
export function connectors(state: ExtensionState): PlatformAdapter[] {
  return [...ADAPTERS, ...learnedSites(state).map(siteConnector)];
}

export function findConnector(state: ExtensionState, platform: Platform) {
  return connectors(state).find((connector) => connector.platform === platform);
}

/** The connector whose site a message came from (by exact origin). */
export async function connectorForOrigin(origin: string | undefined) {
  if (!origin) return undefined;
  return connectors(await readState()).find((connector) => connector.origin === origin);
}

// ── Sync sessions (tabs the extension opened), kept in session storage ───────────────
// Session storage survives service-worker restarts and is cleared when the browser closes.

interface Session {
  platform: Platform;
  tabId: number;
  /** `learn`: the user is looking at a preview of what a new site's page holds. */
  mode: SyncMode | 'learn';
  /** Visible sessions run in an active tab the user watches; hidden ones are closed after. */
  visible: boolean;
  /** The tab's content script has asked for its session (so the scripts are running). */
  checkedIn?: boolean;
  /** The tab was already reloaded once because the scripts didn't check in. */
  retried?: boolean;
}
type Sessions = Record<string, Session>;

/** How long a freshly opened sync tab has to check in before it is reloaded once. */
const CHECK_IN_MS = 15_000;
/** After the page has loaded, time for a check-in message that is still on its way. */
const CHECK_IN_GRACE_MS = 1_000;

/**
 * Safety net: content scripts registered moments before a navigation (e.g. right after
 * "Connect") can miss it. Their script checks in at document_start, so if the page has
 * finished loading (or 15 s have passed) without that, put the scripts back and reload the
 * tab once: a reload always picks them up.
 */
function watchCheckIn(tabId: number) {
  let checked = false;
  const check = () => {
    if (checked) return;
    checked = true;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    void (async () => {
      const session = (await readSessions())[tabId];
      if (!session || session.checkedIn || session.retried) return;
      await updateSessions((sessions) => ({ ...sessions, [tabId]: { ...session, retried: true } }));
      await registerPlatformScripts();
      await chrome.tabs.reload(tabId);
    })().catch(() => undefined);
  };
  const loaded = () => setTimeout(check, CHECK_IN_GRACE_MS);
  const onUpdated = (id: number, change: chrome.tabs.OnUpdatedInfo) => {
    if (id === tabId && change.status === 'complete') loaded();
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  // The page may have finished loading already.
  void chrome.tabs
    .get(tabId)
    .then((tab) => tab.status === 'complete' && loaded())
    .catch(() => undefined);
  setTimeout(check, CHECK_IN_MS);
}

async function markCheckedIn(tabId: number) {
  await updateSessions((sessions) => {
    const session = sessions[tabId];
    return session && !session.checkedIn
      ? { ...sessions, [tabId]: { ...session, checkedIn: true } }
      : sessions;
  });
}

let sessionsQueue: Promise<unknown> = Promise.resolve();

async function readSessions(): Promise<Sessions> {
  const stored = await chrome.storage.session.get('syncSessions');
  return (stored.syncSessions ?? {}) as Sessions;
}

/** Serialised read-modify-write, like updateState. Returns the updated sessions. */
function updateSessions(update: (sessions: Sessions) => Sessions): Promise<Sessions> {
  const run = sessionsQueue.then(async () => {
    const next = update(await readSessions());
    await chrome.storage.session.set({ syncSessions: next });
    return next;
  });
  sessionsQueue = run.catch(() => undefined);
  return run;
}

/** Removes and returns the session for a tab, if any. */
async function takeSession(tabId: number): Promise<Session | undefined> {
  let taken: Session | undefined;
  await updateSessions((sessions) => {
    taken = sessions[tabId];
    const { [tabId]: _removed, ...rest } = sessions;
    return rest;
  });
  if (taken) await chrome.alarms.clear(`${TIMEOUT_ALARM_PREFIX}${tabId}`);
  return taken;
}

function armTimeout(tabId: number) {
  return chrome.alarms.create(`${TIMEOUT_ALARM_PREFIX}${tabId}`, {
    delayInMinutes: SESSION_TIMEOUT_MINUTES,
  });
}

// ── Content scripts ──────────────────────────────────────────────────────────────

let scriptsQueue: Promise<unknown> = Promise.resolve();

/** Registers content scripts for exactly the connected (or being-taught) sites. Idempotent. */
export function registerPlatformScripts(): Promise<void> {
  const run = scriptsQueue.then(async () => {
    const state = await readState();
    const existing = await chrome.scripting.getRegisteredContentScripts();
    const ids = existing.map((script) => script.id).filter((id) => id.startsWith(SCRIPT_ID_PREFIX));
    if (ids.length > 0) await chrome.scripting.unregisterContentScripts({ ids });

    const active = connectors(state).filter(
      (connector) =>
        platformState(state, connector.platform).enabled ||
        state.sites[connector.platform]?.learning === true,
    );
    const scripts = active.flatMap((connector): chrome.scripting.RegisteredContentScript[] => [
      {
        // The network tap must run in the page's own world, before the site's scripts.
        id: `${SCRIPT_ID_PREFIX}${connector.platform}:main`,
        matches: connector.matches,
        js: [connector.scripts.main],
        runAt: 'document_start',
        world: 'MAIN',
      },
      {
        id: `${SCRIPT_ID_PREFIX}${connector.platform}:content`,
        matches: connector.matches,
        js: [connector.scripts.content],
        runAt: 'document_start',
      },
    ]);
    if (scripts.length > 0) await chrome.scripting.registerContentScripts(scripts);
  });
  scriptsQueue = run.catch(() => undefined);
  return run;
}

// ── Scheduling ───────────────────────────────────────────────────────────────────

function scheduleCatchUp(connector: PlatformAdapter) {
  const [min, max] = connector.catchUpMinutes;
  return chrome.alarms.create(`${CATCH_UP_ALARM_PREFIX}${connector.platform}`, {
    delayInMinutes: min + Math.random() * (max - min),
  });
}

/** On browser start and extension install/update: scripts and schedules back in place. */
export async function restorePlatforms(): Promise<void> {
  // A preview left unanswered when the browser closed is abandoned.
  await updateState((state) => ({
    sites: Object.fromEntries(
      learnedSites(state)
        .filter((site) => site.recipe !== null)
        .map((site) => [site.platform, { ...site, learning: false }]),
    ),
  }));
  await registerPlatformScripts();
  const state = await readState();
  for (const connector of connectors(state)) {
    if (!platformState(state, connector.platform).enabled) continue;
    const alarm = await chrome.alarms.get(`${CATCH_UP_ALARM_PREFIX}${connector.platform}`);
    if (!alarm) await scheduleCatchUp(connector);
  }
}

async function runCatchUp(platform: Platform) {
  const state = await readState();
  const connector = findConnector(state, platform);
  const current = platformState(state, platform);
  if (!connector || !current.enabled) return;

  const readRecently =
    current.lastSyncAt !== null &&
    Date.now() - Date.parse(current.lastSyncAt) < MIN_CATCH_UP_GAP_MS;
  // Opening a tab with no browser window would pop a new window up: wait instead.
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (!state.apiToken || readRecently || windows.length === 0) {
    await scheduleCatchUp(connector);
    return;
  }
  const started = await startSession(connector, 'catch-up', false);
  if (!started.ok) await scheduleCatchUp(connector);
}

/** Routes platform alarms. Returns false for alarms that belong to someone else. */
export function handlePlatformAlarm(name: string): boolean {
  if (name.startsWith(CATCH_UP_ALARM_PREFIX)) {
    void runCatchUp(name.slice(CATCH_UP_ALARM_PREFIX.length));
    return true;
  }
  if (name.startsWith(TIMEOUT_ALARM_PREFIX)) {
    void endSession(Number(name.slice(TIMEOUT_ALARM_PREFIX.length)), 'no-response');
    return true;
  }
  return false;
}

// ── Sessions ─────────────────────────────────────────────────────────────────────

/** Sync tabs being opened whose session isn't recorded yet. */
const opening = new Set<Promise<unknown>>();

async function startSession(
  connector: PlatformAdapter,
  mode: SyncMode,
  visible: boolean,
): Promise<ActionResult> {
  const running = Object.values(await readSessions()).find(
    (session) => session.platform === connector.platform,
  );
  if (running) {
    if (visible) await chrome.tabs.update(running.tabId, { active: true }).catch(() => undefined);
    return ok;
  }

  // The tab's content script asks for its session at document_start, possibly before the
  // session below is recorded: sessionFor waits for tabs still being opened.
  const open = (async () => {
    const tab = await chrome.tabs.create({ url: connector.syncUrl, active: visible });
    const tabId = tab.id;
    if (tabId === undefined) return undefined;
    await updateSessions((sessions) => ({
      ...sessions,
      [tabId]: { platform: connector.platform, tabId, mode, visible },
    }));
    return tabId;
  })();
  opening.add(open);
  const tabId = await open.finally(() => opening.delete(open));
  if (tabId === undefined) return fail('Could not open a tab.');
  await armTimeout(tabId);
  if (!visible) await chrome.tabs.update(tabId, { muted: true, autoDiscardable: false });
  watchCheckIn(tabId);
  return ok;
}

function errorFor(label: string, outcome: SyncOutcome): string | null {
  switch (outcome) {
    case 'signed-out':
      return `Sign in to ${label} in this browser, then sync again.`;
    case 'no-response':
      return `${label} didn't load your saved posts. Check that you're signed in, then sync again.`;
    default:
      return null;
  }
}

/** Ends a session: records the outcome, closes background tabs, schedules the next check. */
async function endSession(tabId: number, outcome: SyncOutcome, closeTab = true): Promise<void> {
  const session = await takeSession(tabId);
  if (!session) return;
  if (session.mode === 'learn') {
    // The preview was never answered (tab closed): forget a site that was never confirmed.
    await cancelLearning(session.platform);
    return;
  }
  const connector = findConnector(await readState(), session.platform);
  if (!connector) return;

  const succeeded = outcome === 'complete' || outcome === 'caught-up' || outcome === 'limit';
  const error = errorFor(connector.label, outcome);
  await updateState((state) =>
    withPlatform(state, session.platform, {
      ...(succeeded && { lastSyncAt: new Date().toISOString(), lastError: null }),
      ...(error && { lastError: error }),
      ...(session.mode === 'full' &&
        (outcome === 'complete' || outcome === 'limit') && { fullImportDone: true }),
    }),
  );
  if (closeTab && !session.visible) await chrome.tabs.remove(tabId).catch(() => undefined);
  if (platformState(await readState(), session.platform).enabled) await scheduleCatchUp(connector);
}

export function handleTabRemoved(tabId: number): Promise<void> {
  return endSession(tabId, 'stopped', false);
}

// ── Actions from the popup and the web app ───────────────────────────────────────

/** Built-in connectors only; learned sites connect through "Sync this list". */
export async function connectPlatform(platform: Platform): Promise<ActionResult> {
  const adapter = ADAPTERS.find((candidate) => candidate.platform === platform);
  if (!adapter) return fail('Open its saved page and click Sync this list in the extension.');
  if (!(await readState()).apiToken) return fail('Connect the extension to your account first.');
  await updateState((state) => withPlatform(state, platform, { enabled: true, lastError: null }));
  await registerPlatformScripts();
  await scheduleCatchUp(adapter);
  return startSession(adapter, 'full', true);
}

export async function syncPlatform(platform: Platform, mode: SyncMode): Promise<ActionResult> {
  const state = await readState();
  const connector = findConnector(state, platform);
  if (!connector) return fail('This platform is not connected.');
  if (!platformState(state, platform).enabled) return fail(`Connect ${connector.label} first.`);
  return startSession(connector, mode, true);
}

/** Stops syncing and forgets the platform's sync state. Bookmarks already sent stay. */
export async function disconnectPlatform(platform: Platform): Promise<ActionResult> {
  const state = await readState();
  const connector = findConnector(state, platform);
  if (!connector) return fail('This platform is not connected.');
  await updateState((current) => {
    const { [platform]: _site, ...sites } = current.sites;
    return {
      platforms: { ...current.platforms, [platform]: DEFAULT_PLATFORM_STATE },
      knownIds: { ...current.knownIds, [platform]: [] },
      ...(connector.learned && { sites }),
    };
  });
  await registerPlatformScripts();
  await chrome.alarms.clear(`${CATCH_UP_ALARM_PREFIX}${platform}`);
  const sessions = Object.values(await readSessions()).filter(
    (session) => session.platform === platform,
  );
  for (const session of sessions) await endSession(session.tabId, 'stopped');
  if (connector.learned) await releaseSite(connector.origin);
  return ok;
}

export async function disconnectAllPlatforms(): Promise<void> {
  for (const connector of connectors(await readState())) {
    await disconnectPlatform(connector.platform);
  }
}

export async function getPlatformStatuses(): Promise<PlatformSyncStatus[]> {
  const [state, sessions] = await Promise.all([readState(), readSessions()]);
  const running = new Set(
    Object.values(sessions)
      .filter((session) => session.mode !== 'learn')
      .map((session) => session.platform),
  );
  return connectors(state)
    .filter((connector) => !connector.learned || state.sites[connector.platform]?.recipe)
    .map((connector) => {
      const current = platformState(state, connector.platform);
      return {
        platform: connector.platform,
        label: connector.label,
        enabled: current.enabled,
        syncing: running.has(connector.platform),
        lastSyncAt: current.lastSyncAt,
        lastError: current.lastError,
        itemsSynced: state.knownIds[connector.platform]?.length ?? 0,
        origin: connector.origin,
        learned: connector.learned === true,
      };
    });
}

// ── Learned sites ("Sync this list") ─────────────────────────────────────────────

/** Gives back the optional permission for a site we no longer read. */
async function releaseSite(origin: string) {
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => undefined);
}

async function cancelLearning(platform: Platform) {
  let released: string | null = null;
  await updateState((state) => {
    const site = state.sites[platform];
    if (!site) return {};
    if (site.recipe) return { sites: { ...state.sites, [platform]: { ...site, learning: false } } };
    released = site.origin;
    const { [platform]: _removed, ...sites } = state.sites;
    return { sites };
  });
  await registerPlatformScripts();
  if (released) await releaseSite(released);
}

/**
 * "Sync this list" on the page in `tabId`: remember the site, add the generic scripts and
 * reload the tab so they see the page load from the start. The content script then learns
 * the page and asks the user to confirm (site:confirm / site:reject).
 */
export async function learnSite(tabId: number, pageUrl: string): Promise<ActionResult> {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return fail('This page can’t be synced.');
  }
  if (url.protocol !== 'https:') return fail('Only secure (https://) pages can be synced.');
  if (url.origin === new URL(WEB_URL).origin) return fail('This is Bookmark Captain itself.');

  const state = await readState();
  if (!state.apiToken) return fail('Connect the extension to your account first.');
  const platform = platformForHost(url.hostname);
  const builtIn = ADAPTERS.find((adapter) => adapter.platform === platform);
  if (builtIn) return fail(`${builtIn.label} has its own connector: use Connect ${builtIn.label}.`);
  if (!(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))) {
    return fail('Allow Bookmark Captain to read this site first.');
  }

  // The popup and the permission listener may both start the same tab: once is enough.
  const existing = (await readSessions())[tabId];
  if (startingTabs.has(tabId) || (existing?.mode === 'learn' && existing.platform === platform)) {
    return ok;
  }
  startingTabs.add(tabId);
  try {
    await startLearning(tabId, url, platform);
  } finally {
    startingTabs.delete(tabId);
  }
  return ok;
}

const startingTabs = new Set<number>();

async function startLearning(tabId: number, url: URL, platform: Platform) {
  url.hash = '';
  await updateState((current) => ({
    sites: {
      ...current.sites,
      [platform]: {
        platform,
        label: platformLabel(platform),
        origin: url.origin,
        listUrl: url.toString(),
        recipe: current.sites[platform]?.recipe ?? null,
        learning: true,
      },
    },
  }));
  await registerPlatformScripts();
  await updateSessions((sessions) => ({
    ...sessions,
    [tabId]: { platform, tabId, mode: 'learn', visible: true },
  }));
  await chrome.tabs.reload(tabId);
  watchCheckIn(tabId);
}

export async function siteHello(
  origin: string | undefined,
  tabId: number | undefined,
): Promise<SiteHello> {
  const state = await readState();
  const site = learnedSites(state).find((candidate) => candidate.origin === origin);
  if (!site) return { mode: 'off' };
  const session = tabId === undefined ? undefined : (await readSessions())[tabId];
  if (session?.mode === 'learn' && session.platform === site.platform) {
    await markCheckedIn(session.tabId);
    return { mode: 'learn', platform: site.platform, label: site.label };
  }
  if (!site.recipe || !platformState(state, site.platform).enabled) return { mode: 'off' };
  return {
    mode: 'sync',
    platform: site.platform,
    label: site.label,
    listUrl: site.listUrl,
    recipe: site.recipe,
    session: await sessionFor(site.platform, tabId),
  };
}

/** The user confirmed the preview: keep the recipe, connect the site, import the rest. */
export async function confirmSite(
  origin: string | undefined,
  tabId: number | undefined,
  recipe: unknown,
): Promise<SessionInfo | { ok: false; error: string }> {
  if (!isSiteRecipe(recipe)) return { ok: false, error: 'The learned recipe was invalid.' };
  const state = await readState();
  const site = learnedSites(state).find((candidate) => candidate.origin === origin);
  const session = tabId === undefined ? undefined : (await readSessions())[tabId];
  if (
    !site ||
    tabId === undefined ||
    session?.mode !== 'learn' ||
    session.platform !== site.platform
  ) {
    return {
      ok: false,
      error: 'This page isn’t being set up any more. Click Sync this list again.',
    };
  }

  await updateState((current) => ({
    sites: { ...current.sites, [site.platform]: { ...site, recipe, learning: false } },
    ...withPlatform(current, site.platform, { enabled: true, lastError: null }),
  }));
  await updateSessions((sessions) => ({ ...sessions, [tabId]: { ...session, mode: 'full' } }));
  await armTimeout(tabId);
  await registerPlatformScripts();
  await scheduleCatchUp(siteConnector({ ...site, recipe }));
  return sessionFor(site.platform, tabId);
}

export async function rejectSite(origin: string | undefined, tabId: number | undefined) {
  const site = learnedSites(await readState()).find((candidate) => candidate.origin === origin);
  if (!site) return;
  if (tabId !== undefined) await takeSession(tabId);
  await cancelLearning(site.platform);
}

// ── Messages from a platform's content script ────────────────────────────────────

export async function sessionFor(
  platform: Platform,
  tabId: number | undefined,
): Promise<SessionInfo> {
  await Promise.allSettled([...opening]);
  const session = tabId === undefined ? undefined : (await readSessions())[tabId];
  if (session?.platform !== platform || session.mode === 'learn') return { mode: 'passive' };
  await markCheckedIn(session.tabId);
  const { knownIds } = await readState();
  return {
    mode: session.mode,
    visible: session.visible,
    knownIds: (knownIds[platform] ?? []).slice(0, SESSION_KNOWN_IDS),
  };
}

export async function handleCaptured(
  platform: Platform,
  posts: unknown,
  via: CaptureVia,
): Promise<void> {
  const valid = Array.isArray(posts) ? posts.filter(isCapturedPost) : [];
  if (valid.length === 0) return;
  const now = Date.now();

  await updateState((state) => {
    const current = platformState(state, platform);
    if (!current.enabled) return {};
    const known = state.knownIds[platform] ?? [];
    const { items, newIds } = capturedToItems(platform, valid, {
      known: new Set(known),
      via,
      fullImportDone: current.fullImportDone,
      now,
    });
    return {
      outbox: enqueue(state.outbox, { kind: 'upsert', items }),
      knownIds: { ...state.knownIds, [platform]: [...newIds, ...known].slice(0, KNOWN_IDS_LIMIT) },
      // Reading the saved list counts as a sync; a single live save doesn't.
      ...(via !== 'live' &&
        withPlatform(state, platform, { lastSyncAt: new Date(now).toISOString() })),
    };
  });
  void flush();
}

export async function handleRemoved(platform: Platform, externalIds: unknown): Promise<void> {
  const ids = Array.isArray(externalIds)
    ? externalIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 512,
      )
    : [];
  if (ids.length === 0) return;
  const removed = new Set(ids);

  await updateState((state) => {
    if (!platformState(state, platform).enabled) return {};
    return {
      outbox: enqueue(state.outbox, { kind: 'remove-ids', platform, externalIds: ids }),
      knownIds: {
        ...state.knownIds,
        [platform]: (state.knownIds[platform] ?? []).filter((id) => !removed.has(id)),
      },
    };
  });
  void flush();
}

export async function handleProgress(tabId: number | undefined): Promise<void> {
  if (tabId !== undefined && (await readSessions())[tabId]) await armTimeout(tabId);
}

export async function handleDone(
  tabId: number | undefined,
  outcome: SyncOutcome,
  listedIds?: unknown,
  listEmpty = false,
): Promise<void> {
  if (tabId === undefined) return;
  // The whole list was read: anything synced before that is gone from it was unsaved.
  const session = (await readSessions())[tabId];
  if (session && session.mode !== 'learn' && outcome === 'complete' && Array.isArray(listedIds)) {
    const listed = listedIds.filter((id): id is string => typeof id === 'string');
    const known = (await readState()).knownIds[session.platform] ?? [];
    await handleRemoved(session.platform, unlistedIds(known, listed, { listEmpty }));
  }
  await endSession(tabId, outcome);
}
