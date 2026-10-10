'use client';

import type { Bookmark, BookmarkView } from '@bc/shared';
import { BookmarkCard, type CardLayout } from './bookmark-card';

export const GRID =
  'grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-4 sm:gap-5';
export const LIST = 'divide-y divide-rule rounded-2xl border border-rule bg-surface shadow-card';

/** Bookmarks as a grid of cards or a compact list. */
export function BookmarkCollection({
  items,
  layout,
  view,
  selectedId,
  onTopicSelect,
  dimmed = false,
}: {
  items: Bookmark[];
  layout: CardLayout;
  view: BookmarkView;
  selectedId?: string | null;
  onTopicSelect: (topic: string) => void;
  /** Still showing the previous results while new ones load. */
  dimmed?: boolean;
}) {
  return (
    <ul
      className={`${layout === 'grid' ? GRID : LIST} transition-opacity ${dimmed ? 'opacity-60' : ''}`}
    >
      {items.map((bookmark) => (
        // A grid item stretches its card to the row's height, so footers line up. Its one column is
        // minmax(0, 1fr): an `auto` column would grow to fit a long unbreakable host name and push
        // the card over its neighbours instead of truncating it.
        <li
          key={bookmark.id}
          className={
            layout === 'list' ? 'first:rounded-t-2xl last:rounded-b-2xl' : 'grid grid-cols-1'
          }
        >
          <BookmarkCard
            bookmark={bookmark}
            layout={layout}
            view={view}
            selected={selectedId === bookmark.id}
            onTopicSelect={onTopicSelect}
          />
        </li>
      ))}
    </ul>
  );
}

/** Placeholder shapes while the first page loads. */
export function CollectionSkeleton({ layout }: { layout: CardLayout }) {
  if (layout === 'list') {
    return (
      <ul className={LIST} aria-hidden>
        {[0, 1, 2, 3].map((key) => (
          <li key={key} className="flex gap-3.5 px-5 py-4">
            <span className="size-9 animate-pulse rounded-[10px] bg-sunken" />
            <span className="flex-1 space-y-2.5 pt-1">
              <span className="block h-4 w-2/3 animate-pulse rounded bg-sunken" />
              <span className="block h-3 w-1/3 animate-pulse rounded bg-sunken" />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className={GRID} aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <li key={key} className="overflow-hidden rounded-2xl border border-rule bg-surface">
          <span className="block aspect-[1.91/1] animate-pulse bg-sunken" />
          <span className="block space-y-2.5 p-4">
            <span className="block h-3 w-1/3 animate-pulse rounded bg-sunken" />
            <span className="block h-4 w-5/6 animate-pulse rounded bg-sunken" />
            <span className="block h-4 w-2/3 animate-pulse rounded bg-sunken" />
          </span>
        </li>
      ))}
    </ul>
  );
}
