'use client';

import { platformLabel } from '@bc/shared/constants';
import {
  AlarmClock,
  Check,
  CheckCheck,
  Inbox,
  Layers,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { PlatformLogo, SourceIcon } from '@/components/ui/platform-logo';
import { displayHost } from '@/lib/format';
import { hueFor } from '@/lib/thumbnail';
import { SAMPLES, type Sample } from './samples';

const SHOWN = SAMPLES.slice(0, 4);

/**
 * A playable miniature of the inbox in a browser window, with sample saves and no account
 * needed: mark them done or snooze them until the inbox is clear.
 */
export function ProductPreview() {
  const [items, setItems] = useState(SHOWN);
  const [leaving, setLeaving] = useState<string | null>(null);

  function clear(item: Sample) {
    setLeaving(item.id);
    setTimeout(() => {
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setLeaving(null);
    }, 200);
  }

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-x-8 -inset-y-10 -z-10 rounded-[3rem] bg-[radial-gradient(60%_60%_at_60%_40%,var(--color-accent-wash),transparent)]" />
      <div className="overflow-hidden rounded-2xl border border-rule bg-paper shadow-[0_40px_80px_-32px_rgb(15_23_41/0.35)]">
        <div className="flex items-center gap-3 border-b border-rule bg-surface px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto rounded-md bg-sunken px-3 py-0.5 text-xs text-ink-soft">
            bookmarkcaptain.app/inbox
          </span>
          <span className="w-10" />
        </div>

        <div className="flex">
          <div
            aria-hidden
            className="hidden w-40 shrink-0 space-y-0.5 border-r border-rule p-2.5 text-[13px] sm:block"
          >
            <p className="flex items-center gap-2 rounded-lg bg-surface px-2 py-1.5 font-semibold shadow-card ring-1 ring-rule">
              <Inbox size={14} />
              Inbox
              <span className="ml-auto rounded-full bg-accent px-1.5 text-[10px] font-semibold text-surface">
                {items.length}
              </span>
            </p>
            <p className="flex items-center gap-2 px-2 py-1.5 text-ink-soft">
              <AlarmClock size={14} />
              Snoozed
            </p>
            <p className="flex items-center gap-2 px-2 py-1.5 text-ink-soft">
              <Layers size={14} />
              All
            </p>
            <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-ink-soft">Sources</p>
            {(['browser', 'x', 'reddit', 'youtube', 'instagram'] as const).map((platform) => (
              <p key={platform} className="flex items-center gap-2 px-2 py-1 text-ink-soft">
                <PlatformLogo platform={platform} size={16} />
                {platformLabel(platform)}
              </p>
            ))}
          </div>

          <div className="min-w-0 flex-1 p-3.5 sm:p-4">
            <div
              aria-hidden
              className="mb-3.5 flex h-9 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3 text-xs text-ink-faint shadow-card"
            >
              <Search size={14} />
              Search your saves, or paste a link
            </div>

            {items.length === 0 ? (
              <div className="grid min-h-[19rem] place-items-center rounded-xl border border-dashed border-rule-strong bg-surface/60 p-6 text-center">
                <div>
                  <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent-wash text-accent">
                    <CheckCheck size={22} aria-hidden />
                  </span>
                  <p className="mt-3 font-semibold">Your inbox is clear</p>
                  <p className="mt-1 text-sm text-ink-soft">That&apos;s the whole idea.</p>
                  <button
                    type="button"
                    onClick={() => setItems(SHOWN)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-rule-strong bg-surface px-3 py-1.5 text-[13px] font-medium shadow-card hover:bg-sunken"
                  >
                    <RotateCcw size={13} aria-hidden />
                    Put them back
                  </button>
                </div>
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`overflow-hidden rounded-xl border border-rule bg-surface shadow-card transition-[opacity,transform] duration-200 ${
                      leaving === item.id ? 'scale-95 opacity-0' : ''
                    }`}
                  >
                    <div
                      className="cover-tint relative grid h-20 place-items-center"
                      style={{ '--hue': hueFor(displayHost(item.url)) } as CSSProperties}
                    >
                      <SourceIcon platform={item.platform} url={item.url} size={34} />
                    </div>
                    <div className="p-3">
                      <p className="flex justify-between text-[11px] text-ink-soft">
                        <span className="truncate font-medium">{item.byline}</span>
                        <span>{item.age}</span>
                      </p>
                      <p className="mt-1 line-clamp-2 text-[13px] leading-snug font-semibold">
                        {item.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-soft">
                        <Sparkles size={11} className="mr-1 inline text-accent" aria-hidden />
                        {item.summary}
                      </p>
                      <div className="mt-2 -ml-1.5 flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => clear(item)}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-ink-soft hover:bg-sunken hover:text-ink"
                        >
                          <Check size={13} aria-hidden />
                          Done
                        </button>
                        <button
                          type="button"
                          onClick={() => clear(item)}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-ink-soft hover:bg-sunken hover:text-ink"
                        >
                          <AlarmClock size={13} aria-hidden />
                          Snooze
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <p aria-live="polite" className="mt-3 text-center text-[13px] text-ink-soft">
        Sample saves. Try clearing them.
      </p>
    </div>
  );
}
