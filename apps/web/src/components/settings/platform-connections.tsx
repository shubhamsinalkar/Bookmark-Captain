'use client';

import type { Platform, PlatformAction, PlatformSyncStatus } from '@bc/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SignalFlag } from '@/components/ui/signal-flag';
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

/**
 * Platforms the extension syncs from your own signed-in pages (X, Reddit, Instagram, YouTube, learned sites). The extension
 * holds this state, so the page asks it through the bridge rather than the API.
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

  if (view.phase === 'detecting') return <p className={hint}>Looking for the extension…</p>;

  if (view.phase !== 'ready') {
    return (
      <div className="rounded-xl border border-dashed border-rule-strong px-5 py-6">
        <p className="text-sm">
          {view.phase === 'no-extension'
            ? 'Platforms sync through the Chrome extension, which isn’t installed in this browser.'
            : 'Connect the extension to your account first.'}
        </p>
        <Link href="/extension/connect" className={`${buttonSecondary} mt-4`}>
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
            <li key={platform.platform} className="flex flex-wrap items-start gap-4 px-4 py-4">
              <SignalFlag platform={platform.platform} size={28} decorative className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {platform.label}
                  {platform.learned && (
                    <span className="ml-2 text-[13px] font-normal text-ink-soft">
                      learned from your saved page
                    </span>
                  )}
                </p>
                {platform.enabled ? (
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-ink-soft">
                    <span className="font-medium text-good">Connected</span>
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
                  <p role="alert" className="mt-1 text-[13px] text-danger">
                    {platform.lastError}
                  </p>
                )}
                {platform.enabled && (
                  <div className="mt-2 -ml-2 flex flex-wrap gap-1">
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
      <div className="rounded-xl border border-dashed border-rule-strong px-4 py-4">
        <p className="text-sm font-semibold">Any other site</p>
        <p className={`${hint} mt-1 max-w-prose`}>
          Open the page that lists your saved posts (LinkedIn Saved posts, a Pinterest board…),
          click the Bookmark Captain extension and choose Sync this list. It learns the page, shows
          you what it found, and keeps checking for new saves.
        </p>
      </div>
      <p className={`${hint} max-w-prose`}>
        The extension reads your saved lists in your own signed-in browser, so your passwords never
        leave it. Posts you save on your phone arrive at the next check, every 30–60 minutes while
        Chrome is open.
      </p>
    </div>
  );
}
