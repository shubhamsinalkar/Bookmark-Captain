'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, LoaderCircle, RotateCw } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { BrandMark } from '@/components/ui/brand';
import { PlatformLogo } from '@/components/ui/platform-logo';
import { buttonPrimary, buttonSecondary, hint, pageTitle, panel } from '@/components/ui/styles';
import { createApiToken, queryKeys, revokeApiToken } from '@/lib/api/bookmarks';
import { askExtension, postToExtension, waitForExtension } from '@/lib/extension-bridge';

const code = 'rounded-md bg-sunken px-1.5 py-0.5 text-[13px] text-ink';

const DETECT_TIMEOUT_MS = 3000;
const CONNECT_TIMEOUT_MS = 8000;

const DEVELOPMENT = process.env.NODE_ENV === 'development';

// Once the extension is on the Chrome Web Store, link its listing here.
const INSTALL_STEPS: ReactNode[] = [<>Install the Bookmark Captain extension in this profile.</>];

/** Local development: build and load the extension from the repo. */
const DEV_INSTALL_STEPS: ReactNode[] = [
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
];

const RELOAD_STEP: ReactNode = <>Reload this page.</>;

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

  const linked = state.phase === 'connected' || (state.phase === 'ready' && state.alreadyConnected);

  return (
    <div className="mx-auto max-w-xl py-4 sm:py-10">
      <div className="flex items-center justify-center gap-3" aria-hidden>
        <span className="rounded-2xl bg-surface p-2 shadow-lift ring-1 ring-rule">
          <PlatformLogo platform="browser" size={44} />
        </span>
        <span className="flex gap-1">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className={`size-1.5 rounded-full ${linked ? 'bg-good' : 'bg-rule-strong'}`}
            />
          ))}
        </span>
        <span className="rounded-2xl bg-surface p-2 shadow-lift ring-1 ring-rule">
          <BrandMark size={44} />
        </span>
      </div>
      <h1 className={`${pageTitle} mt-7 text-center`}>
        {linked ? 'This browser is connected' : 'Connect the Chrome extension'}
      </h1>
      <p className={`${hint} mx-auto mt-2 max-w-md text-center`}>
        {linked
          ? 'Your browser bookmarks and the platforms you connect keep arriving in your inbox.'
          : 'It imports your browser bookmarks, keeps them in sync, and reads the saved lists of X, Reddit, Instagram, LinkedIn, YouTube and other sites.'}
      </p>

      <section className={`${panel} mt-8 space-y-5 p-6 sm:p-7`} aria-live="polite">
        {state.phase === 'detecting' && (
          <p className={`${hint} inline-flex items-center gap-2`}>
            <LoaderCircle size={15} className="animate-spin" aria-hidden />
            Looking for the extension…
          </p>
        )}

        {state.phase === 'missing' && (
          <>
            <p className="text-sm leading-relaxed">
              The Bookmark Captain extension isn&apos;t installed in this Chrome profile. Each
              Chrome profile needs its own copy.
            </p>
            <ol className="space-y-3 text-sm">
              {[...(DEVELOPMENT ? DEV_INSTALL_STEPS : INSTALL_STEPS), RELOAD_STEP].map(
                (step, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 text-ink-soft">{step}</span>
                  </li>
                ),
              )}
            </ol>
            {/* Chrome only injects the extension's bridge while a page loads, so a fresh check
                without reloading could never find a just-installed extension. */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={buttonSecondary}
            >
              <RotateCw size={15} aria-hidden />
              Reload page
            </button>
          </>
        )}

        {state.phase === 'ready' && !state.alreadyConnected && (
          <>
            <p className="text-sm leading-relaxed">
              Extension found. Connect it to your account to start syncing bookmarks.
            </p>
            <button
              type="button"
              onClick={() => void connect()}
              className={`${buttonPrimary} w-full py-2.5`}
            >
              Connect extension
            </button>
          </>
        )}

        {state.phase === 'ready' && state.alreadyConnected && (
          <>
            <p className="flex items-start gap-2.5 text-sm leading-relaxed">
              <CircleCheck size={18} className="mt-0.5 shrink-0 text-good" aria-hidden />
              Nothing to do here: new bookmarks and saves sync on their own.
            </p>
            <Link href="/inbox" className={`${buttonPrimary} w-full py-2.5`}>
              Go to inbox
            </Link>
            <p className={`${hint} text-center`}>
              Not syncing?{' '}
              <button
                type="button"
                onClick={() => void connect()}
                className="font-medium text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
              >
                Reconnect the extension
              </button>{' '}
              to give it a new access key.
            </p>
          </>
        )}

        {state.phase === 'connecting' && (
          <p className={`${hint} inline-flex items-center gap-2`}>
            <LoaderCircle size={15} className="animate-spin" aria-hidden />
            Connecting…
          </p>
        )}

        {state.phase === 'connected' && (
          <>
            <p className="flex items-start gap-2.5 text-sm font-semibold text-good">
              <CircleCheck size={18} className="mt-px shrink-0" aria-hidden />
              Connected. Your browser bookmarks are being imported now.
            </p>
            <Link href="/inbox" className={`${buttonPrimary} w-full py-2.5`}>
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
