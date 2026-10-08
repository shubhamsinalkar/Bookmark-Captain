'use client';

import { type BookmarkView, type Platform, platformLabel, platformSchema } from '@bc/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { SearchIcon } from '@/components/ui/icons';
import { buttonSecondary, hint, input, panel } from '@/components/ui/styles';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useLiveBookmarks } from '@/hooks/use-live-bookmarks';
import {
  type BookmarkFilters,
  listBookmarks,
  listBookmarkSources,
  queryKeys,
} from '@/lib/api/bookmarks';
import { AddLinkForm } from './add-link-form';
import { BookmarkCard } from './bookmark-card';
import { ImportBookmarksButton } from './import-bookmarks-button';

const numberFormat = new Intl.NumberFormat('en');

const VIEWS: { value: BookmarkView; label: string }[] = [
  { value: 'inbox', label: 'Inbox' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'done', label: 'Done' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
];

const EMPTY_MESSAGES: Record<BookmarkView, { title: string; hint: string }> = {
  inbox: {
    title: 'Your inbox is clear',
    hint: 'Paste a link above, import a bookmarks.html file, or connect the Chrome extension to sync your browser.',
  },
  snoozed: { title: 'Nothing snoozed', hint: 'Snoozed items come back to your inbox on time.' },
  done: { title: 'Nothing done yet', hint: 'Mark items as done once you have used them.' },
  archived: { title: 'Nothing archived', hint: 'Archive items you want to keep out of the way.' },
  all: { title: 'No bookmarks yet', hint: 'Paste a link above or import your browser bookmarks.' },
};

export function InboxView() {
  const [view, setView] = useState<BookmarkView>('inbox');
  const [platform, setPlatform] = useState<Platform | undefined>();
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);

  useLiveBookmarks();

  const filters: BookmarkFilters = { view, platform, q: q || undefined };
  const query = useInfiniteQuery({
    queryKey: queryKeys.bookmarkList(filters),
    queryFn: ({ pageParam }) => listBookmarks(filters, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const sources = useQuery({ queryKey: queryKeys.bookmarkSources, queryFn: listBookmarkSources });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(platform ?? q);

  return (
    <div className="space-y-8">
      <h1 className="sr-only">Bookmarks</h1>

      <section aria-label="Add bookmarks" className="space-y-2.5">
        <AddLinkForm />
        <ImportBookmarksButton />
      </section>

      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Bookmark views"
          className="flex gap-6 overflow-x-auto border-b border-rule"
        >
          {VIEWS.map((option) => {
            const selected = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setView(option.value)}
                className={`-mb-px border-b-2 pt-1 pb-2.5 text-sm whitespace-nowrap transition-colors ${
                  selected
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-ink-soft hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-soft">
              <SearchIcon />
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search titles, links, authors and topics"
              aria-label="Search bookmarks"
              className={`${input} pl-9`}
            />
          </div>
          <select
            value={platform ?? ''}
            onChange={(event) => {
              const parsed = platformSchema.safeParse(event.target.value);
              setPlatform(parsed.success ? parsed.data : undefined);
            }}
            aria-label="Filter by platform"
            className="w-36 shrink-0 cursor-pointer rounded-md border border-rule-strong bg-surface px-2.5 py-2 text-sm text-ink transition-colors outline-none hover:border-ink-soft focus:border-focus focus:ring-3 focus:ring-focus/20 sm:w-44"
          >
            <option value="">All platforms</option>
            {/* Only the platforms and sites you actually have bookmarks from. */}
            {sources.data?.map((source) => (
              <option key={source.platform} value={source.platform}>
                {platformLabel(source.platform)} ({numberFormat.format(source.count)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <section role="tabpanel" aria-busy={query.isPending}>
        {query.isPending ? (
          <LoadingList />
        ) : query.isError ? (
          <div className="rounded-xl border border-danger/30 bg-danger-wash px-6 py-10 text-center">
            <p className="font-semibold text-danger">Couldn&apos;t load bookmarks.</p>
            <p className={`${hint} mt-1`}>Check that the API is running, then try again.</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className={`${buttonSecondary} mt-4`}
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-rule-strong px-6 py-16 text-center">
            <p className="text-lg font-semibold font-stretch-112%">
              {filtered ? 'No bookmarks match your filters' : EMPTY_MESSAGES[view].title}
            </p>
            <p className={`${hint} mx-auto mt-1.5 max-w-sm`}>
              {filtered ? 'Try a different search or platform.' : EMPTY_MESSAGES[view].hint}
            </p>
            {!filtered && view === 'inbox' && (
              <Link href="/extension/connect" className={`${buttonSecondary} mt-5`}>
                Connect the Chrome extension
              </Link>
            )}
          </div>
        ) : (
          <>
            <ul className={`${panel} divide-y divide-rule`}>
              {items.map((bookmark) => (
                <li key={bookmark.id} className="first:rounded-t-xl last:rounded-b-xl">
                  <BookmarkCard bookmark={bookmark} onTopicSelect={setSearch} />
                </li>
              ))}
            </ul>
            {query.hasNextPage && (
              <div className="flex justify-center pt-6">
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
          </>
        )}
      </section>
    </div>
  );
}

function LoadingList() {
  return (
    <ul className={`${panel} divide-y divide-rule`} aria-hidden>
      {[0, 1, 2].map((key) => (
        <li key={key} className="flex gap-4 px-5 py-5">
          <span className="h-4.5 w-6 animate-pulse rounded-sm bg-sunken" />
          <span className="flex-1 space-y-2.5">
            <span className="block h-4 w-2/3 animate-pulse rounded bg-sunken" />
            <span className="block h-3 w-1/3 animate-pulse rounded bg-sunken" />
          </span>
        </li>
      ))}
    </ul>
  );
}
