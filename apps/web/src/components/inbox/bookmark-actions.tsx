'use client';

import type { Bookmark, UpdateBookmarkRequest } from '@bc/shared';
import {
  AlarmClock,
  AlarmClockOff,
  Archive,
  Check,
  Copy,
  Ellipsis,
  ExternalLink,
  type LucideIcon,
  Trash2,
  Undo2,
} from 'lucide-react';
import { type ComponentProps, type KeyboardEvent, useCallback, useRef, useState } from 'react';
import { floating, menuItem } from '@/components/ui/styles';
import { useToast } from '@/components/ui/toaster';
import { useDismiss } from '@/hooks/use-dismiss';
import type { Triage } from '@/hooks/use-triage';
import { morningInDays } from '@/lib/format';

const SNOOZE_OPTIONS = [
  { label: 'Tomorrow morning', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

const whenFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** Runs an action; `patch` tells the card whether the bookmark will leave the open view. */
export type Act = (run: () => void, patch?: UpdateBookmarkRequest) => void;

interface ActionButtonProps extends ComponentProps<'button'> {
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  /** Lets keyboard shortcuts find this button on the selected card. */
  action?: string;
}

function ActionButton({ label, icon: Icon, shortcut, action, ...props }: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      data-action={action}
      className="group/tip relative inline-grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft transition-[background-color,color,transform] hover:bg-sunken hover:text-ink active:scale-90 aria-expanded:bg-sunken aria-expanded:text-ink"
      {...props}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 hidden -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-surface opacity-0 shadow-float transition-opacity can-hover:block can-hover:group-hover/tip:opacity-100 can-hover:group-hover/tip:delay-300"
      >
        {label}
        {shortcut && <span className="ml-1.5 opacity-60">{shortcut}</span>}
      </span>
    </button>
  );
}

/** Up and down arrows move between the items of an open menu. */
function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

/** Focuses the first item when a menu opens. */
const focusFirstItem = (menu: HTMLDivElement | null) => {
  menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
};

export function BookmarkActions({
  bookmark,
  triage,
  act,
  className = '',
}: {
  bookmark: Bookmark;
  triage: Triage;
  act: Act;
  className?: string;
}) {
  const toast = useToast();
  const [menu, setMenu] = useState<'snooze' | 'more' | null>(null);
  const [openUp, setOpenUp] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setMenu(null);
    setConfirmingDelete(false);
  }, []);
  useDismiss(menu !== null, ref, close);

  function toggle(which: 'snooze' | 'more') {
    // Open upwards when the menu would run off the bottom of the screen.
    const rect = ref.current?.getBoundingClientRect();
    setOpenUp(rect ? rect.bottom + 240 > window.innerHeight : false);
    setConfirmingDelete(false);
    setMenu((current) => (current === which ? null : which));
  }

  const isActive = bookmark.status === 'unread' || bookmark.status === 'opened';
  const isSnoozed = bookmark.snoozeUntil !== null && new Date(bookmark.snoozeUntil) > new Date();
  const menuPosition = `absolute right-0 z-40 w-60 ${openUp ? 'bottom-full mb-1.5 origin-bottom-right' : 'top-full mt-1.5 origin-top-right'}`;

  return (
    <div
      ref={ref}
      data-open={menu !== null}
      className={`relative flex items-center gap-0.5 ${className}`}
    >
      {isActive ? (
        <ActionButton
          label="Done"
          icon={Check}
          shortcut="E"
          action="done"
          onClick={() => act(() => triage.done(bookmark), { status: 'done' })}
        />
      ) : (
        <ActionButton
          label="Back to inbox"
          icon={Undo2}
          action="back"
          onClick={() =>
            act(() => triage.backToInbox(bookmark), { status: 'unread', snoozeUntil: null })
          }
        />
      )}

      {isActive &&
        (isSnoozed ? (
          <ActionButton
            label="Unsnooze"
            icon={AlarmClockOff}
            action="unsnooze"
            onClick={() => act(() => triage.unsnooze(bookmark), { snoozeUntil: null })}
          />
        ) : (
          <ActionButton
            label="Snooze"
            icon={AlarmClock}
            shortcut="S"
            action="snooze"
            aria-haspopup="menu"
            aria-expanded={menu === 'snooze'}
            onClick={() => toggle('snooze')}
          />
        ))}

      {bookmark.status !== 'archived' && (
        <ActionButton
          label="Archive"
          icon={Archive}
          shortcut="A"
          action="archive"
          onClick={() => act(() => triage.archive(bookmark), { status: 'archived' })}
        />
      )}

      <ActionButton
        label="More actions"
        icon={Ellipsis}
        aria-haspopup="menu"
        aria-expanded={menu === 'more'}
        onClick={() => toggle('more')}
      />

      {menu === 'snooze' && (
        <div
          ref={focusFirstItem}
          role="menu"
          aria-label="Snooze until"
          onKeyDown={onMenuKeyDown}
          className={`${floating} ${menuPosition}`}
        >
          <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-ink-soft">Snooze until</p>
          {SNOOZE_OPTIONS.map((option) => {
            const until = morningInDays(option.days);
            const when = whenFormat.format(until);
            return (
              <button
                key={option.days}
                type="button"
                role="menuitem"
                className={`${menuItem} justify-between`}
                onClick={() => {
                  close();
                  act(() => triage.snooze(bookmark, until, when), {
                    snoozeUntil: until.toISOString(),
                  });
                }}
              >
                {option.label}
                <span className="text-xs text-ink-soft tabular-nums">{when}</span>
              </button>
            );
          })}
        </div>
      )}

      {menu === 'more' && (
        <div
          ref={focusFirstItem}
          role="menu"
          aria-label="More actions"
          onKeyDown={onMenuKeyDown}
          className={`${floating} ${menuPosition}`}
        >
          <a
            role="menuitem"
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            className={menuItem}
            onClick={() => {
              close();
              triage.markOpened(bookmark);
            }}
          >
            <ExternalLink size={15} className="text-ink-soft" aria-hidden />
            Open in a new tab
          </a>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => {
              close();
              navigator.clipboard.writeText(bookmark.url).then(
                () => toast({ message: 'Link copied' }),
                () => toast({ message: 'Couldn’t copy the link.', tone: 'error' }),
              );
            }}
          >
            <Copy size={15} className="text-ink-soft" aria-hidden />
            Copy link
          </button>
          <div className="my-1 h-px bg-rule" />
          {confirmingDelete ? (
            <button
              type="button"
              role="menuitem"
              autoFocus
              className={`${menuItem} bg-danger-wash font-semibold text-danger hover:bg-danger hover:text-surface focus-visible:bg-danger focus-visible:text-surface`}
              onClick={() => {
                close();
                act(() => triage.remove(bookmark));
              }}
            >
              <Trash2 size={15} aria-hidden />
              Delete for good
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              className={`${menuItem} text-danger`}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 size={15} aria-hidden />
              Delete…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
