'use client';

import type { Platform } from '@bc/shared';
import { useState } from 'react';
import { CheckIcon, ClockIcon, FolderIcon } from '@/components/ui/icons';
import { SignalFlag } from '@/components/ui/signal-flag';
import { buttonGhost, buttonSecondary, panel } from '@/components/ui/styles';

interface Sample {
  id: string;
  platform: Platform;
  title: string;
  host: string;
  saved: string;
  folder?: string;
}

const SAMPLES: Sample[] = [
  {
    id: 'mdn',
    platform: 'browser',
    title: 'CSS container queries',
    host: 'developer.mozilla.org',
    saved: 'Saved 2 days ago',
    folder: 'Frontend',
  },
  {
    id: 'flags',
    platform: 'browser',
    title: 'International maritime signal flags',
    host: 'en.wikipedia.org',
    saved: 'Saved 5 days ago',
    folder: 'Reading',
  },
  {
    id: 'pg',
    platform: 'manual',
    title: 'WITH Queries (Common Table Expressions)',
    host: 'postgresql.org',
    saved: 'Saved last week',
  },
  {
    id: '12f',
    platform: 'browser',
    title: 'The Twelve-Factor App',
    host: '12factor.net',
    saved: 'Saved 3 weeks ago',
    folder: 'Bookmarks bar',
  },
];

/** A playable miniature of the inbox, with sample bookmarks and no account needed. */
export function TryInbox() {
  const [items, setItems] = useState(SAMPLES);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState('');

  function clear(item: Sample, action: string) {
    setLeaving(item.id);
    setLastAction(`${action}: ${item.title}`);
    setTimeout(() => {
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setLeaving(null);
    }, 220);
  }

  return (
    <div>
      <div className={`${panel} shadow-[0_24px_48px_-24px_rgb(15_42_61/0.35)]`}>
        <div className="flex items-baseline justify-between border-b border-rule px-5 py-3">
          <p className="text-sm font-semibold">Inbox</p>
          <p className="text-[13px] text-ink-soft">
            {items.length === 0 ? 'All clear' : `${items.length} to read`}
          </p>
        </div>

        {items.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-lg font-semibold font-stretch-112%">Your inbox is clear</p>
            <p className="mt-1 text-sm text-ink-soft">That&apos;s the whole idea.</p>
            <button
              type="button"
              className={`${buttonSecondary} mt-5`}
              onClick={() => {
                setItems(SAMPLES);
                setLastAction('');
              }}
            >
              Put them back
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-rule">
            {items.map((item) => (
              <li
                key={item.id}
                className={`flex gap-4 px-5 py-4 transition-[opacity,translate] duration-200 ${
                  leaving === item.id ? 'translate-x-6 opacity-0' : ''
                }`}
              >
                <SignalFlag platform={item.platform} size={22} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] leading-snug font-semibold">{item.title}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-soft">
                    <span>{item.host}</span>
                    <span>{item.saved}</span>
                    {item.folder && (
                      <span className="inline-flex items-center gap-1">
                        <FolderIcon />
                        {item.folder}
                      </span>
                    )}
                  </p>
                  <div className="mt-2 -ml-2 flex gap-0.5">
                    <button
                      type="button"
                      className={buttonGhost}
                      onClick={() => clear(item, 'Marked done')}
                    >
                      <CheckIcon />
                      Done
                    </button>
                    <button
                      type="button"
                      className={buttonGhost}
                      onClick={() => clear(item, 'Snoozed until tomorrow, 9:00')}
                    >
                      <ClockIcon />
                      Snooze
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p aria-live="polite" className="mt-3 min-h-5 text-[13px] text-ink-soft">
        {lastAction || 'Sample bookmarks. Try marking one done.'}
      </p>
    </div>
  );
}
