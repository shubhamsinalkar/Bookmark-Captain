import type { Bookmark, BookmarkView } from '@bc/shared';

/**
 * Client-side mirror of the API's view filters (see bookmark.service.ts `list`). Used for
 * optimistic updates: an item that no longer matches the open view disappears immediately,
 * and the refetch that follows confirms it.
 */
export function matchesView(
  bookmark: Pick<Bookmark, 'status' | 'snoozeUntil'>,
  view: BookmarkView,
  now: Date = new Date(),
): boolean {
  const active = bookmark.status === 'unread' || bookmark.status === 'opened';
  const snoozed = bookmark.snoozeUntil !== null && new Date(bookmark.snoozeUntil) > now;

  switch (view) {
    case 'inbox':
      return active && !snoozed;
    case 'snoozed':
      return active && snoozed;
    case 'done':
    case 'archived':
      return bookmark.status === view;
    case 'all':
      return true;
  }
}
