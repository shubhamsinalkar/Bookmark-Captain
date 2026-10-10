'use client';

import { type BookmarkCounts, type BookmarkView, platformLabel } from '@bc/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AlarmClock, Archive, CheckCheck, Inbox, LayoutGrid, Rows3, SearchX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { LogoOrbit } from '@/components/ui/logo-orbit';
import { PlatformLogo } from '@/components/ui/platform-logo';
import { buttonPrimary, buttonSecondary, hint, pageTitle } from '@/components/ui/styles';
import { useCardLayout } from '@/hooks/use-card-layout';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useHydrated } from '@/hooks/use-hydrated';
import { useLiveBookmarks } from '@/hooks/use-live-bookmarks';
import {
  type BookmarkFilters,
  getBookmarkCounts,
  listBookmarks,
  queryKeys,
  searchByMeaning,
} from '@/lib/api/bookmarks';
import { inboxHref, looksLikeLink, parseInboxParams } from '@/lib/inbox-url';
import type { CardLayout } from './bookmark-card';
import { BookmarkCollection, CollectionSkeleton } from './bookmark-collection';
import { ImportBookmarksButton } from './import-bookmarks-button';
import { MeaningResults } from './meaning-results';
import { SearchOrSave } from './search-or-save';

const numberFormat = new Intl.NumberFormat('en');

/** Shorter searches are usually still being typed, and don't carry a meaning to match. */
const MIN_MEANING_QUERY = 3;

export const VIEW_TITLES: Record<BookmarkView, string> = {
  inbox: 'Inbox',
  snoozed: 'Snoozed',
  done: 'Done',
  archived: 'Archived',
  all: 'All bookmarks',
};

function summaryFor(view: BookmarkView, counts: BookmarkCounts): string {
  const n = (value: number) => numberFormat.format(value);
  switch (view) {
    case 'inbox':
      return counts.inbox === 0
        ? 'Nothing waiting for you'
        : `${n(counts.unread)} unread of ${n(counts.inbox)} waiting`;
    case 'snoozed':
      return counts.snoozed === 0
        ? 'Snoozed saves come back to your inbox on time'
        : `${n(counts.snoozed)} coming back later`;
    case 'done':
      return counts.done === 0 ? 'Saves you have finished with' : `${n(counts.done)} read and done`;
    case 'archived':
      return counts.archived === 0
        ? 'Saves you want to keep out of the way'
        : `${n(counts.archived)} kept out of the way`;
    case 'all':
      return `${n(counts.all)} ${counts.all === 1 ? 'bookmark' : 'bookmarks'} from every source`;
  }
}

export function InboxView() {
  const { view, source } = parseInboxParams(useSearchParams());
  const [search, setSearch] = useState('');
  const isLink = looksLikeLink(search);
  const q = useDebouncedValue(isLink ? '' : search.trim(), 300);
  const [layout, setLayout] = useCardLayout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useLiveBookmarks();

  const filters: BookmarkFilters = { view, platform: source, q: q || undefined };
  const query = useInfiniteQuery({
    queryKey: queryKeys.bookmarkList(filters),
    queryFn: ({ pageParam }) => listBookmarks(filters, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  // Alongside the word search, find bookmarks about the same idea in other words.
  const meaningQ = q.length >= MIN_MEANING_QUERY ? q : undefined;
  const meaning = useQuery({
    queryKey: queryKeys.bookmarkMeaningSearch({ view, platform: source, q: meaningQ }),
    queryFn: () => searchByMeaning({ view, platform: source, q: meaningQ! }),
    enabled: meaningQ !== undefined,
    // Keep showing the last results while the next search loads, instead of jumping.
    placeholderData: keepPreviousData,
    // A 503 means the embedding provider is rate limited; retrying right away won't help.
    retry: false,
  });
  const meaningItems = meaningQ && meaning.data?.available ? meaning.data.items : [];

  const counts = useQuery({ queryKey: queryKeys.bookmarkCounts, queryFn: getBookmarkCounts });
  const hydrated = useHydrated();

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(source ?? q);
  const navigable = [...items, ...meaningItems.map((match) => match.bookmark)];

  useTriageKeys(navigable, selectedId, setSelectedId, searchRef);

  // Load the next page as the end of the list scrolls into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: '600px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className={`${pageTitle} flex items-center gap-3`}>
            {source && <PlatformLogo platform={source} size={30} />}
            <span className="truncate">{source ? platformLabel(source) : VIEW_TITLES[view]}</span>
          </h1>
          <p className={`${hint} mt-1`}>
            {source ? (
              <>
                {VIEW_TITLES[view]} from {platformLabel(source)}.{' '}
                <Link
                  href={inboxHref({ view })}
                  className="font-medium text-ink underline-offset-[3px] hover:underline"
                >
                  Show every source
                </Link>
              </>
            ) : hydrated && counts.data ? (
              summaryFor(view, counts.data)
            ) : (
              ' '
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportBookmarksButton />
          <LayoutToggle layout={layout} onChange={setLayout} />
        </div>
      </header>

      <SearchOrSave value={search} onChange={setSearch} inputRef={searchRef} />

      <section aria-label="Bookmarks" aria-busy={query.isPending}>
        {query.isPending ? (
          <CollectionSkeleton layout={layout} />
        ) : query.isError ? (
          <div className="rounded-2xl border border-danger/25 bg-danger-wash px-6 py-12 text-center">
            <p className="font-semibold text-danger">Couldn&apos;t load bookmarks.</p>
            <p className={`${hint} mt-1`}>Check that the API is running, then try again.</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className={`${buttonSecondary} mt-5`}
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 && meaningQ && meaning.isPending ? (
          <CollectionSkeleton layout={layout} />
        ) : items.length === 0 && meaningItems.length > 0 ? (
          <>
            <p className={hint}>
              No bookmarks contain &ldquo;{q}&rdquo;, but these are about the same thing.
            </p>
            <MeaningResults
              search={meaning}
              layout={layout}
              view={view}
              selectedId={selectedId}
              onTopicSelect={setSearch}
            />
          </>
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              art={
                <IconTile>
                  <SearchX size={28} className="text-ink-soft" aria-hidden />
                </IconTile>
              }
              title="No bookmarks match your filters"
              body="Try other words, or look in every source."
            >
              {source && (
                <Link href={inboxHref({ view })} className={buttonSecondary}>
                  Show every source
                </Link>
              )}
            </EmptyState>
          ) : (
            <EmptyView view={view} />
          )
        ) : (
          <>
            <BookmarkCollection
              items={items}
              layout={layout}
              view={view}
              selectedId={selectedId}
              onTopicSelect={setSearch}
            />
            <div ref={sentinel} />
            {query.hasNextPage && (
              <div className="flex justify-center pt-8">
                <button
                  type="button"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className={buttonSecondary}
                >
                  {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
            {meaningQ && (
              <MeaningResults
                search={meaning}
                layout={layout}
                view={view}
                selectedId={selectedId}
                onTopicSelect={setSearch}
              />
            )}
            <ShortcutHints />
          </>
        )}
      </section>
    </div>
  );
}

function LayoutToggle({
  layout,
  onChange,
}: {
  layout: CardLayout;
  onChange: (layout: CardLayout) => void;
}) {
  const options = [
    { value: 'grid', label: 'Cards', icon: LayoutGrid },
    { value: 'list', label: 'List', icon: Rows3 },
  ] as const;
  return (
    <div
      role="group"
      aria-label="Layout"
      className="inline-flex h-9 items-center rounded-[10px] border border-rule-strong bg-surface p-0.5 shadow-card"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={layout === value}
          title={label}
          onClick={() => onChange(value)}
          className="grid h-full w-8 place-items-center rounded-lg text-ink-soft transition-colors hover:text-ink aria-pressed:bg-sunken aria-pressed:text-ink"
        >
          <Icon size={16} aria-hidden />
        </button>
      ))}
    </div>
  );
}

function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-16 place-items-center rounded-2xl border border-rule bg-surface shadow-card">
      {children}
    </span>
  );
}

function EmptyState({
  art,
  title,
  body,
  children,
}: {
  art: ReactNode;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-rule-strong bg-surface/50 px-6 py-14 text-center">
      {art}
      <p className="mt-6 text-lg font-semibold tracking-[-0.01em]">{title}</p>
      <p className={`${hint} mt-1.5 max-w-sm text-balance`}>{body}</p>
      {children && <div className="mt-6 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

const EMPTY_VIEWS: Record<
  Exclude<BookmarkView, 'inbox'>,
  { icon: ReactNode; title: string; body: string }
> = {
  snoozed: {
    icon: <AlarmClock size={28} className="text-caution" aria-hidden />,
    title: 'Nothing snoozed',
    body: 'Snooze a bookmark to hide it until a better time. It comes back to your inbox on its own.',
  },
  done: {
    icon: <CheckCheck size={28} className="text-good" aria-hidden />,
    title: 'Nothing done yet',
    body: 'Mark bookmarks done once you have read or watched them.',
  },
  archived: {
    icon: <Archive size={28} className="text-ink-soft" aria-hidden />,
    title: 'Nothing archived',
    body: 'Archive bookmarks you want to keep but not see in your inbox.',
  },
  all: {
    icon: <Inbox size={28} className="text-ink-soft" aria-hidden />,
    title: 'No bookmarks yet',
    body: 'Paste a link above, import your browser bookmarks, or connect a platform.',
  },
};

function EmptyView({ view }: { view: BookmarkView }) {
  if (view !== 'inbox') {
    const empty = EMPTY_VIEWS[view];
    return (
      <EmptyState art={<IconTile>{empty.icon}</IconTile>} title={empty.title} body={empty.body} />
    );
  }
  return (
    <EmptyState
      art={
        <LogoOrbit>
          <CheckCheck size={30} className="text-accent" aria-hidden />
        </LogoOrbit>
      }
      title="Your inbox is clear"
      body="New saves from your browser and connected platforms land here within seconds."
    >
      <Link href="/settings#platforms" className={buttonPrimary}>
        Connect a platform
      </Link>
      <Link href="/extension/connect" className={buttonSecondary}>
        Connect the Chrome extension
      </Link>
    </EmptyState>
  );
}

function ShortcutHints() {
  const keys: [string, string][] = [
    ['J K', 'move'],
    ['Enter', 'open'],
    ['E', 'done'],
    ['S', 'snooze'],
    ['A', 'archive'],
    ['Z', 'undo'],
    ['/', 'search'],
  ];
  return (
    <p className="hidden flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-10 text-xs text-ink-soft can-hover:flex">
      {keys.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          {key.split(' ').map((part) => (
            <kbd
              key={part}
              className="grid h-5 min-w-5 place-items-center rounded border border-rule border-b-2 bg-surface px-1 font-sans text-[11px] font-semibold"
            >
              {part}
            </kbd>
          ))}
          {label}
        </span>
      ))}
    </p>
  );
}

/**
 * Keyboard triage: J/K select, Enter opens, E/S/A act on the selection, Z undoes, / searches.
 * Actions click the selected card's own buttons, so they behave exactly like a click.
 */
function useTriageKeys(
  items: { id: string }[],
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
  searchRef: RefObject<HTMLInputElement | null>,
) {
  const state = useRef({ items, selectedId });
  useEffect(() => {
    state.current = { items, selectedId };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]')) {
        return;
      }
      const ids = state.current.items.map((item) => item.id);
      const at = state.current.selectedId ? ids.indexOf(state.current.selectedId) : -1;
      const card = at >= 0 ? document.querySelector(`[data-bookmark-id="${ids[at]}"]`) : null;
      const select = (index: number) => {
        const id = ids[index];
        if (!id) return;
        setSelectedId(id);
        document
          .querySelector(`[data-bookmark-id="${id}"]`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      const press = (selector: string, moveOn: boolean) => {
        const button = card?.querySelector<HTMLElement>(selector);
        if (!button) return;
        event.preventDefault();
        if (moveOn) setSelectedId(ids[at + 1] ?? ids[at - 1] ?? null);
        button.click();
      };

      switch (event.key) {
        case 'j':
          event.preventDefault();
          select(Math.min(at + 1, ids.length - 1));
          break;
        case 'k':
          event.preventDefault();
          select(Math.max(at - 1, 0));
          break;
        case '/':
          event.preventDefault();
          searchRef.current?.focus();
          break;
        case 'Escape':
          setSelectedId(null);
          break;
        case 'e':
          press('[data-action="done"], [data-action="back"]', true);
          break;
        case 'a':
          press('[data-action="archive"]', true);
          break;
        case 's':
          press('[data-action="snooze"]', false);
          break;
        case 'Enter':
        case 'o':
          if (target !== document.body) return;
          press('h2 a', false);
          break;
        case 'z':
          document.querySelector<HTMLElement>('[data-toast-action]')?.click();
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [setSelectedId, searchRef]);
}
