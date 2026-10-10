'use client';

import type { Bookmark, BookmarkView } from '@bc/shared';
import { AlarmClock, Folder, Play, Sparkles } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { SourceIcon } from '@/components/ui/platform-logo';
import { applyPatch } from '@/hooks/use-bookmark-mutations';
import { useTriage } from '@/hooks/use-triage';
import { matchesView } from '@/lib/bookmark-view';
import { cardText, CONTENT_TYPE_LABELS, formatMinutes, SHELF_LIFE_LABELS } from '@/lib/enrichment';
import { displayHost, formatAge } from '@/lib/format';
import { type Act, BookmarkActions } from './bookmark-actions';
import { BookmarkCover, useThumbnail } from './bookmark-cover';

export type CardLayout = 'grid' | 'list';

/** How long a card takes to fade out before the list closes the gap. */
const LEAVE_MS = 170;

const SHELF_LIFE_STYLES = {
  evergreen: 'text-good',
  timely: 'text-ink-soft',
  ephemeral: 'text-caution',
} as const;

const snoozeFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const savedFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

interface BookmarkCardProps {
  bookmark: Bookmark;
  layout?: CardLayout;
  /** The view the card is shown in: an action that moves it out of the view fades it away. */
  view?: BookmarkView;
  /** Highlighted by keyboard navigation. */
  selected?: boolean;
  /** Called with a topic when its chip is clicked, e.g. to search for it. */
  onTopicSelect?: (topic: string) => void;
}

export function BookmarkCard({
  bookmark,
  layout = 'grid',
  view = 'all',
  selected = false,
  onTopicSelect,
}: BookmarkCardProps) {
  const triage = useTriage();
  const [leaving, setLeaving] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const act: Act = (run, patch) => {
    const leaves = patch ? !matchesView(applyPatch(bookmark, patch), view) : true;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!leaves || reduceMotion) {
      run();
      return;
    }
    setLeaving(true);
    setTimeout(run, LEAVE_MS);
  };

  const isUnread = bookmark.status === 'unread';
  const isSnoozed = bookmark.snoozeUntil !== null && new Date(bookmark.snoozeUntil) > new Date();
  const folder = typeof bookmark.metadata.folder === 'string' ? bookmark.metadata.folder : null;
  const { title, summary, original } = cardText(bookmark);
  const enriched = bookmark.ai?.status === 'done' ? bookmark.ai : null;
  const contentLabel = enriched?.contentType ? CONTENT_TYPE_LABELS[enriched.contentType] : null;
  const shelfLife = enriched?.shelfLife ?? null;
  const byline = bookmark.author ?? displayHost(bookmark.url);
  const open = () => triage.markOpened(bookmark);

  const titleLink = (
    <a
      href={bookmark.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={open}
      className="rounded-sm wrap-break-word decoration-ink-faint/60 underline-offset-[3px] hover:underline"
    >
      {title}
    </a>
  );

  const unreadDot = isUnread && (
    <span className="mr-2 inline-block size-2 shrink-0 translate-y-[-2px] rounded-full bg-accent align-middle">
      <span className="sr-only">Unread: </span>
    </span>
  );

  const body = (
    <>
      {summary && !showOriginal ? (
        <p className="mt-1.5 line-clamp-3 max-w-[75ch] text-sm leading-relaxed text-ink-soft">
          <Sparkles size={13} className="mr-1.5 inline -translate-y-px text-accent" aria-hidden />
          <span className="sr-only">AI summary: </span>
          {summary}
        </p>
      ) : (
        original && (
          <p className="mt-1.5 line-clamp-4 max-w-[75ch] text-sm leading-relaxed whitespace-pre-line text-ink-soft">
            {original}
          </p>
        )
      )}
      {summary && original && (
        <button
          type="button"
          onClick={() => setShowOriginal((shown) => !shown)}
          className="mt-1 self-start rounded-sm text-[13px] font-medium text-ink-soft underline-offset-[3px] hover:text-ink hover:underline"
        >
          {showOriginal ? 'Show summary' : 'Show original'}
        </button>
      )}

      {bookmark.ai?.status === 'pending' && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
          <Sparkles size={13} className="animate-pulse text-accent" aria-hidden />
          Summarising…
        </p>
      )}

      {enriched && enriched.topics.length > 0 && (
        <ul aria-label="Topics" className="mt-2.5 flex flex-wrap gap-1.5">
          {enriched.topics.map((topic) => (
            <li key={topic}>
              <button
                type="button"
                onClick={() => onTopicSelect?.(topic)}
                title={`Show bookmarks about ${topic}`}
                className="rounded-full bg-sunken px-2.5 py-0.5 text-xs font-medium text-ink-soft transition-colors hover:bg-accent-wash hover:text-accent"
              >
                {topic}
              </button>
            </li>
          ))}
        </ul>
      )}

      {isSnoozed && bookmark.snoozeUntil && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-caution">
          <AlarmClock size={14} aria-hidden />
          Back in your inbox {snoozeFormat.format(new Date(bookmark.snoozeUntil))}
        </p>
      )}
    </>
  );

  const facts = (
    <>
      {contentLabel && <span className="font-medium text-ink">{contentLabel}</span>}
      {enriched?.readMinutes != null && (
        <span title="Estimated time to read or watch">{formatMinutes(enriched.readMinutes)}</span>
      )}
      {shelfLife && (
        <span className={SHELF_LIFE_STYLES[shelfLife]} title={SHELF_LIFE_LABELS[shelfLife].hint}>
          {SHELF_LIFE_LABELS[shelfLife].label}
        </span>
      )}
      {folder && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <Folder size={13} aria-hidden className="shrink-0" />
          <span className="truncate">{folder}</span>
        </span>
      )}
    </>
  );

  const age = (
    <time
      dateTime={bookmark.savedAt}
      title={`Saved ${savedFormat.format(new Date(bookmark.savedAt))}`}
      className="shrink-0 text-xs text-ink-soft tabular-nums"
    >
      {formatAge(bookmark.savedAt)}
    </time>
  );

  const actions = <BookmarkActions bookmark={bookmark} triage={triage} act={act} />;

  if (layout === 'list') {
    return (
      <ListRow
        bookmark={bookmark}
        selected={selected}
        leaving={leaving}
        onOpen={open}
        icon={<SourceIcon platform={bookmark.platform} url={bookmark.url} size={36} />}
      >
        <div className="flex items-start gap-3">
          <h2 className="line-clamp-2 min-w-0 flex-1 text-[15px] leading-snug font-semibold tracking-[-0.01em]">
            {unreadDot}
            {titleLink}
          </h2>
          {age}
        </div>
        {/* On phones the actions move under the summary (`contents` + `order-last`). */}
        <div className="mt-1 flex items-center gap-3 max-sm:contents">
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[13px] text-ink-soft max-sm:mt-1 max-sm:flex-none">
            <span className="truncate">{byline}</span>
            {facts}
          </p>
          <div className="reveal-on-hover -my-1.5 -mr-1.5 shrink-0 max-sm:order-last max-sm:mt-2 max-sm:mb-0 max-sm:-ml-2 max-sm:self-start">
            {actions}
          </div>
        </div>
        {body}
      </ListRow>
    );
  }

  return (
    <article
      data-bookmark-id={bookmark.id}
      data-selected={selected}
      data-leaving={leaving}
      className="group relative flex flex-col rounded-2xl border border-rule bg-surface shadow-card transition-[box-shadow,transform,opacity,border-color] duration-200 ease-out has-[[data-open=true]]:z-30 can-hover:hover:-translate-y-0.5 can-hover:hover:shadow-lift data-[leaving=true]:scale-[0.96] data-[leaving=true]:opacity-0 data-[selected=true]:border-accent/60 data-[selected=true]:shadow-lift data-[selected=true]:ring-4 data-[selected=true]:ring-accent/10"
    >
      <a
        href={bookmark.url}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        aria-hidden
        onClick={open}
        className="relative block aspect-[1.91/1] overflow-hidden rounded-t-[15px] border-b border-rule bg-sunken"
      >
        <BookmarkCover bookmark={bookmark} />
        {contentLabel === 'Video' && enriched?.readMinutes != null && (
          <span className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums backdrop-blur">
            <Play size={10} fill="currentColor" aria-hidden />
            {formatMinutes(enriched.readMinutes)}
          </span>
        )}
      </a>

      <div className="flex flex-1 flex-col p-4 pt-3.5">
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <SourceIcon platform={bookmark.platform} url={bookmark.url} size={18} />
          <span className="truncate font-medium">{byline}</span>
          <span className="ml-auto" />
          {age}
        </div>
        <h2 className="mt-1.5 line-clamp-3 text-base leading-snug font-semibold tracking-[-0.01em]">
          {unreadDot}
          {titleLink}
        </h2>
        {body}
        <div className="mt-auto flex items-end gap-2 pt-3">
          <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5 pb-1.5 text-xs text-ink-soft">
            {facts}
          </p>
          <div className="reveal-on-hover -mr-1.5 -mb-1">{actions}</div>
        </div>
      </div>
    </article>
  );
}

function ListRow({
  bookmark,
  selected,
  leaving,
  onOpen,
  icon,
  children,
}: {
  bookmark: Bookmark;
  selected: boolean;
  leaving: boolean;
  onOpen: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  const { src, onError } = useThumbnail(bookmark);
  return (
    <article
      data-bookmark-id={bookmark.id}
      data-selected={selected}
      data-leaving={leaving}
      className="group relative flex gap-3.5 px-4 py-4 transition-[background-color,opacity,transform] duration-200 ease-out has-[[data-open=true]]:z-30 can-hover:hover:bg-sunken/40 data-[leaving=true]:translate-x-4 data-[leaving=true]:opacity-0 data-[selected=true]:bg-accent-wash/40 data-[selected=true]:shadow-[inset_3px_0_0_var(--color-accent)] sm:px-5"
    >
      <span className="mt-0.5">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      {src && (
        <a
          href={bookmark.url}
          target="_blank"
          rel="noopener noreferrer"
          tabIndex={-1}
          aria-hidden
          onClick={onOpen}
          className="relative hidden aspect-[4/3] w-28 shrink-0 self-start overflow-hidden rounded-xl border border-rule bg-sunken sm:block md:w-32"
        >
          {/* Pictures come from any site the bookmark points to. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={onError}
            className="size-full object-cover"
          />
        </a>
      )}
    </article>
  );
}
