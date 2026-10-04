'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SignalFlag } from '@/components/ui/signal-flag';
import { buttonPrimary, buttonSecondary, hint, panel } from '@/components/ui/styles';
import { createApiToken, queryKeys, revokeApiToken } from '@/lib/api/bookmarks';
import { askExtension, postToExtension, waitForExtension } from '@/lib/extension-bridge';

const code = 'rounded bg-sunken px-1 py-0.5 text-[13px] text-ink';

const DETECT_TIMEOUT_MS = 3000;
const CONNECT_TIMEOUT_MS = 8000;

type State =
  | { phase: 'detecting' }
  | { phase: 'missing' }
  | { phase: 'ready'; alreadyConnected: boolean }
  | { phase: 'connecting' }
  | { phase: 'connected' }
  | { phase: 'failed'; message: string };

/** Pings the extension's content script and reports what it found. */
async function detectExtension(): Promise<State> {
  const pong = await askExtension({ type: 'ping' }, 'pong', DETECT_TIMEOUT_MS);
  return pong ? { phase: 'ready', alreadyConnected: pong.connected } : { phase: 'missing' };
}

/**
 * Hands the extension an API token. The extension's content script runs on this page and
 * relays window messages to its background worker, so no extension id needs configuring.
 */
export function ExtensionConnect() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ phase: 'detecting' });

  useEffect(() => {
    let active = true;
    void detectExtension().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, []);

  function detectAgain() {
    setState({ phase: 'detecting' });
    void detectExtension().then(setState);
  }

  async function connect() {
    setState({ phase: 'connecting' });
    let tokenId: string | undefined;
    try {
      const { token, apiToken } = await createApiToken('Chrome extension');
      tokenId = apiToken.id;
      const reply = waitForExtension(['connected', 'connect-failed'], CONNECT_TIMEOUT_MS);
      postToExtension({ type: 'connect', token });
      const result = await reply;
      if (result?.type !== 'connected') {
        throw new Error(
          result?.type === 'connect-failed' ? result.error : 'The extension did not respond.',
        );
      }
      setState({ phase: 'connected' });
    } catch (error) {
      // Don't leave an unused credential behind.
      if (tokenId) await revokeApiToken(tokenId).catch(() => undefined);
      setState({
        phase: 'failed',
        message: error instanceof Error ? error.message : 'Connecting failed.',
      });
    } finally {
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiTokens });
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <SignalFlag platform="browser" size={28} decorative />
        <h1 className="text-2xl font-bold tracking-tight font-stretch-112%">
          Connect the Chrome extension
        </h1>
      </div>

      <section className={`${panel} space-y-4 p-6`} aria-live="polite">
        {state.phase === 'detecting' && <p className={hint}>Looking for the extension…</p>}

        {state.phase === 'missing' && (
          <>
            <p className="text-sm leading-relaxed">
              The Bookmark Captain extension isn&apos;t installed in this browser (or this page was
              open before it was installed).
            </p>
            <ol className="space-y-2.5 text-sm">
              {[
                <>
                  Build it: <code className={code}>pnpm --filter @bc/extension build</code>
                </>,
                <>
                  Open <code className={code}>chrome://extensions</code> and turn on{' '}
                  <strong>Developer mode</strong>.
                </>,
                <>
                  Click <strong>Load unpacked</strong> and choose{' '}
                  <code className={code}>apps/extension/dist</code>.
                </>,
                <>Come back to this page and check again.</>,
              ].map((step, index) => (
                <li key={index} className="flex gap-3">
                  <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full border border-rule-strong text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className="pt-0.5 text-ink-soft">{step}</span>
                </li>
              ))}
            </ol>
            <button type="button" onClick={detectAgain} className={buttonSecondary}>
              Check again
            </button>
          </>
        )}

        {state.phase === 'ready' && (
          <>
            <p className="text-sm leading-relaxed">
              {state.alreadyConnected
                ? 'The extension is already connected. Reconnecting replaces its access key.'
                : 'Extension found. Connect it to your account to start syncing bookmarks.'}
            </p>
            <button type="button" onClick={() => void connect()} className={buttonPrimary}>
              {state.alreadyConnected ? 'Reconnect extension' : 'Connect extension'}
            </button>
          </>
        )}

        {state.phase === 'connecting' && <p className={hint}>Connecting…</p>}

        {state.phase === 'connected' && (
          <>
            <p className="text-sm font-semibold text-good">
              Connected. Your browser bookmarks are being imported now.
            </p>
            <Link href="/inbox" className={buttonPrimary}>
              Go to inbox
            </Link>
          </>
        )}

        {state.phase === 'failed' && (
          <>
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
            <button type="button" onClick={detectAgain} className={buttonSecondary}>
              Try again
            </button>
          </>
        )}
      </section>
    </div>
  );
}
