'use client';

import type { Platform, PlatformAction, PlatformSyncStatus } from '@bc/shared';
import { LoaderCircle, RefreshCw, ScanSearch } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Favicon, PlatformLogo } from '@/components/ui/platform-logo';
import { buttonGhost, buttonPrimary, buttonSecondary, hint, panel } from '@/components/ui/styles';
import { askExtension } from '@/lib/extension-bridge';
import { formatRelativeTime } from '@/lib/format';

const REPLY_TIMEOUT_MS = 3_000;
const ACTION_TIMEOUT_MS = 10_000;
const numberFormat = new Intl.NumberFormat('en');

type View =
  | { phase: 'detecting' }
  | { phase: 'no-extension' }
  | { phase: 'not-linked' }
  | { phase: 'ready'; platforms: PlatformSyncStatus[] };

async function loadView(): Promise<View> {
  const pong = await askExtension({ type: 'ping' }, 'pong', REPLY_TIMEOUT_MS);
  if (!pong) return { phase: 'no-extension' };
  if (!pong.connected) return { phase: 'not-linked' };
  const reply = await askExtension({ type: 'platforms-request' }, 'platforms', REPLY_TIMEOUT_MS);
  return reply ? { phase: 'ready', platforms: reply.platforms } : { phase: 'no-extension' };
}

/** Sites people often teach with "Sync this list", shown as examples. */
const EXAMPLE_SITES = ['pinterest.com', 'medium.com', 'producthunt.com', 'dev.to'];

/**
 * Platforms the extension syncs from your own signed-in pages (X, Reddit, Instagram, YouTube,
 * learned sites). The extension holds this state, so the page asks it through the bridge
 * rather than the API.
 */
export function PlatformConnections() {
  const [view, setView] = useState<View>({ phase: 'detecting' });
  const [pending, setPending] = useState<`${Platform}:${PlatformAction}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => setView(await loadView()), []);

  useEffect(() => {
    let active = true;
    const load = () => {
      void loadView().then((next) => {
        if (active) setView(next);
      });
    };
    load();
    // Syncs run in another tab: refresh when you come back to this one.
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, []);

  const syncing = view.phase === 'ready' && view.platforms.some((platform) => platform.syncing);
  useEffect(() => {
    if (!syncing) return;
    const timer = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(timer);
  }, [syncing, refresh]);

  async function run(platform: Platform, action: PlatformAction) {
    setPending(`${platform}:${action}`);
    setError(null);
    const result = await askExtension(
      { type: 'platform-action', platform, action },
      'platform-action-result',
      ACTION_TIMEOUT_MS,
    );
    setPending(null);
    if (!result?.ok) setError(result?.error ?? 'The extension did not respond. Try again.');
    await refresh();
  }

  if (view.phase === 'detecting') {
    return (
      <p className={`${hint} inline-flex items-center gap-2`}>
        <LoaderCircle size={15} className="animate-spin" aria-hidden />
        Looking for the extension…
      </p>
    );
  }

  if (view.phase !== 'ready') {
    return (
      <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-dashed border-rule-strong bg-surface/60 p-5">
        <div className="flex -space-x-2">
          {(['x', 'reddit', 'instagram', 'youtube'] as const).map((platform) => (
            <span key={platform} className="rounded-[11px] ring-2 ring-paper">
              <PlatformLogo platform={platform} size={36} />
            </span>
          ))}
        </div>
        <div className="min-w-[12rem] flex-1">
          <p className="text-sm font-medium">
            {view.phase === 'no-extension'
              ? 'Platforms sync through the Chrome extension, which isn’t installed in this browser.'
              : 'Connect the extension to your account first.'}
          </p>
          <p className={`${hint} mt-0.5`}>
            It reads your saved lists in your own signed-in browser.
          </p>
        </div>
        <Link href="/extension/connect" className={buttonPrimary}>
          Set up the extension
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ul className={`${panel} divide-y divide-rule`}>
        {view.platforms.map((platform) => {
          const busy = (action: PlatformAction) => pending === `${platform.platform}:${action}`;
          return (
            <li key={platform.platform} className="flex flex-wrap items-start gap-4 px-5 py-4">
              <PlatformLogo platform={platform.platform} size={40} />
              <div className="min-w-[12rem] flex-1">
                <p className="font-semibold">
                  {platform.label}
                  {platform.learned && (
                    <span className="ml-2 text-[13px] font-normal text-ink-soft">
                      learned from your saved page
                    </span>
                  )}
                </p>
                {platform.enabled ? (
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-good/10 px-2 py-0.5 text-xs font-semibold text-good">
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                      Connected
                    </span>
                    <span>{numberFormat.format(platform.itemsSynced)} posts synced</span>
                    <span>
                      {platform.syncing
                        ? 'Syncing now…'
                        : platform.lastSyncAt
                          ? `Checked ${formatRelativeTime(platform.lastSyncAt)}`
                          : 'Not checked yet'}
                    </span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-[13px] text-ink-soft">
                    Imports your {platform.label} bookmarks, then keeps checking for new ones.
                  </p>
                )}
                {platform.lastError && (
                  <p role="alert" className="mt-1.5 text-[13px] text-danger">
                    {platform.lastError}
                  </p>
                )}
                {platform.enabled && (
                  <div className="mt-2 -ml-2.5 flex flex-wrap gap-1">
                    <button
                      type="button"
                      className={buttonGhost}
                      disabled={pending !== null}
                      onClick={() => void run(platform.platform, 'import-all')}
                    >
                      {busy('import-all') ? 'Opening…' : 'Re-import all'}
                    </button>
                    <button
                      type="button"
                      className={`${buttonGhost} hover:text-danger`}
                      disabled={pending !== null}
                      onClick={() => void run(platform.platform, 'disconnect')}
                    >
                      {busy('disconnect') ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </div>
                )}
              </div>
              {platform.enabled ? (
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={pending !== null || platform.syncing}
                  onClick={() => void run(platform.platform, 'sync')}
                >
                  <RefreshCw
                    size={15}
                    className={platform.syncing || busy('sync') ? 'animate-spin' : ''}
                    aria-hidden
                  />
                  {busy('sync') ? 'Opening…' : 'Sync now'}
                </button>
              ) : (
                <button
                  type="button"
                  className={buttonPrimary}
                  disabled={pending !== null}
                  onClick={() => void run(platform.platform, 'connect')}
                >
                  {busy('connect') ? 'Opening…' : `Connect ${platform.label}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-4 rounded-2xl border border-dashed border-rule-strong bg-surface/60 p-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-wash text-accent">
          <ScanSearch size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Any other site</p>
          <p className={`${hint} mt-1 max-w-prose`}>
            Open the page that lists your saved posts (LinkedIn Saved posts, a Pinterest board…),
            click the Bookmark Captain extension and choose Sync this list. It learns the page,
            shows you what it found, and keeps checking for new saves.
          </p>
          <div className="mt-3 flex items-center gap-2">
            {EXAMPLE_SITES.map((site) => (
              <Favicon key={site} host={site} size={24} label={site} />
            ))}
            <span className="text-xs text-ink-soft">and more</span>
          </div>
        </div>
      </div>
      <p className={`${hint} max-w-prose`}>
        The extension reads your saved lists in your own signed-in browser, so your passwords never
        leave it. Posts you save on your phone arrive at the next check, every 30–60 minutes while
        Chrome is open.
      </p>
    </div>
  );
}
