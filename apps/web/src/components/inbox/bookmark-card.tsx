'use client';

import type { Bookmark, UpdateBookmarkRequest } from '@bc/shared';
import { useEffect, useRef, useState } from 'react';
import {
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  FolderIcon,
  ReturnIcon,
  TrashIcon,
} from '@/components/ui/icons';
import { SignalFlag } from '@/components/ui/signal-flag';
import { buttonDanger, buttonGhost } from '@/components/ui/styles';
import { useBookmarkMutations } from '@/hooks/use-bookmark-mutations';
import {
  displayHost,
  displayUrl,
  formatRelativeTime,
  morningInDays,
  snippetFor,
} from '@/lib/format';

const SNOOZE_OPTIONS = [
  { label: 'Tomorrow morning', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

const snoozeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function BookmarkCard({ bookmark }: { bookmark: Bookmark }) {
  const { update, remove } = useBookmarkMutations();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);

  // Close the snooze menu on Escape or a click anywhere else.
  useEffect(() => {
    if (!snoozeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!snoozeRef.current?.contains(event.target as Node)) setSnoozeOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSnoozeOpen(false);
      snoozeRef.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [snoozeOpen]);

  const patch = (changes: UpdateBookmarkRequest) =>
    update.mutate({ id: bookmark.id, patch: changes });

  const isUnread = bookmark.status === 'unread';
  const isActive = isUnread || bookmark.status === 'opened';
  const isSnoozed = bookmark.snoozeUntil !== null && new Date(bookmark.snoozeUntil) > new Date();
  const folder = typeof bookmark.metadata.folder === 'string' ? bookmark.metadata.folder : null;
  const title = bookmark.title ?? displayUrl(bookmark.url);
  const snippet = snippetFor(bookmark.title, bookmark.text);

  return (
    <article className="group relative flex gap-4 rounded-[inherit] px-4 py-4 transition-colors hover:bg-sunken/50 sm:px-5">
      <SignalFlag platform={bookmark.platform} size={22} className="mt-0.5 shrink-0" />

      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-3 pr-4 text-[15px] leading-snug">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => isUnread && patch({ status: 'opened' })}
            className={`rounded-sm wrap-break-word decoration-rule-strong underline-offset-3 hover:underline ${
              isUnread ? 'font-semibold' : 'font-medium text-ink/80'
            }`}
          >
            {title}
          </a>
        </h2>
        {isUnread && (
          <span
            className="absolute top-5 right-4 size-2 rounded-full bg-focus sm:right-5"
            title="Unread"
          >
            <span className="sr-only">Unread</span>
          </span>
        )}

        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-soft">
          {/* Posts show who wrote them; links show where they live. */}
          <span className="truncate">{bookmark.author ?? displayHost(bookmark.url)}</span>
          <time dateTime={bookmark.savedAt} title={new Date(bookmark.savedAt).toLocaleString()}>
            Saved {formatRelativeTime(bookmark.savedAt)}
          </time>
          {folder && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <FolderIcon />
              <span className="truncate">{folder}</span>
            </span>
          )}
        </p>

        {snippet && <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{snippet}</p>}

        {isSnoozed && bookmark.snoozeUntil && (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-medium text-caution">
            <ClockIcon />
            Back in your inbox {snoozeFormat.format(new Date(bookmark.snoozeUntil))}
          </p>
        )}

        <div
          data-open={snoozeOpen || confirmingDelete}
          className="reveal-on-hover mt-2 -ml-2 flex flex-wrap items-center gap-0.5 can-hover:absolute can-hover:top-3 can-hover:right-3 can-hover:m-0 can-hover:flex-nowrap can-hover:rounded-lg can-hover:border can-hover:border-rule can-hover:bg-surface can-hover:p-0.5 can-hover:shadow-[0_4px_12px_-6px_rgb(15_42_61/0.3)]"
        >
          {isActive ? (
            <button type="button" className={buttonGhost} onClick={() => patch({ status: 'done' })}>
              <CheckIcon />
              Done
            </button>
          ) : (
            <button
              type="button"
              className={buttonGhost}
              onClick={() => patch({ status: 'unread', snoozeUntil: null })}
            >
              <ReturnIcon />
              Back to inbox
            </button>
          )}

          {isActive &&
            (isSnoozed ? (
              <button
                type="button"
                className={buttonGhost}
                onClick={() => patch({ snoozeUntil: null })}
              >
                <ClockIcon />
                Unsnooze
              </button>
            ) : (
              <div ref={snoozeRef} className="relative">
                <button
                  type="button"
                  className={`${buttonGhost} ${snoozeOpen ? 'bg-sunken text-ink' : ''}`}
                  aria-expanded={snoozeOpen}
                  aria-haspopup="menu"
                  onClick={() => setSnoozeOpen((open) => !open)}
                >
                  <ClockIcon />
                  Snooze
                </button>
                {snoozeOpen && (
                  <div
                    role="menu"
                    aria-label="Snooze until"
                    className="absolute top-full left-0 z-20 mt-1 w-48 rounded-lg border border-rule bg-surface p-1 shadow-[0_8px_24px_-8px_rgb(15_42_61/0.25)]"
                  >
                    {SNOOZE_OPTIONS.map((option) => (
                      <button
                        key={option.days}
                        type="button"
                        role="menuitem"
                        className="flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-sunken"
                        onClick={() => {
                          setSnoozeOpen(false);
                          patch({ snoozeUntil: morningInDays(option.days).toISOString() });
                        }}
                      >
                        {option.label}
                        <span className="text-xs text-ink-soft">9:00</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

          {bookmark.status !== 'archived' && (
            <button
              type="button"
              className={buttonGhost}
              onClick={() => patch({ status: 'archived' })}
            >
              <ArchiveIcon />
              Archive
            </button>
          )}

          <span className="ml-auto flex items-center gap-1 can-hover:ml-0">
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  className={buttonDanger}
                  onClick={() => remove.mutate(bookmark.id)}
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className={buttonGhost}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`${buttonGhost} hover:text-danger`}
                onClick={() => setConfirmingDelete(true)}
              >
                <TrashIcon />
                <span className="max-sm:sr-only">Delete</span>
              </button>
            )}
          </span>
        </div>

        {(update.isError || remove.isError) && (
          <p role="alert" className="mt-1.5 text-[13px] text-danger">
            That didn&apos;t save. Please try again.
          </p>
        )}
      </div>
    </article>
  );
}
