'use client';

import type { Bookmark, BookmarkPage, UpdateBookmarkRequest } from '@bc/shared';
import {
  type InfiniteData,
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type BookmarkFilters,
  deleteBookmark,
  queryKeys,
  updateBookmark,
} from '@/lib/api/bookmarks';
import { matchesView } from '@/lib/bookmark-view';

type Pages = InfiniteData<BookmarkPage, string | null>;
type Snapshot = [QueryKey, Pages | undefined][];

function applyPatch(bookmark: Bookmark, patch: UpdateBookmarkRequest): Bookmark {
  return {
    ...bookmark,
    ...(patch.status !== undefined && { status: patch.status }),
    ...(patch.snoozeUntil !== undefined && { snoozeUntil: patch.snoozeUntil }),
  };
}

/**
 * Status/snooze/delete mutations with optimistic cache updates: the list reacts instantly,
 * rolls back on failure, and is refetched from the server once the request settles.
 */
export function useBookmarkMutations() {
  const queryClient = useQueryClient();

  async function updateCachedLists(
    transform: (bookmark: Bookmark, filters: BookmarkFilters) => Bookmark | null,
  ): Promise<Snapshot> {
    // Lists only: other queries under 'bookmarks' (e.g. sources) hold different data.
    await queryClient.cancelQueries({ queryKey: queryKeys.bookmarkLists });
    const snapshot = queryClient.getQueriesData<Pages>({ queryKey: queryKeys.bookmarkLists });

    for (const [key, data] of snapshot) {
      if (!data) continue;
      const filters = key[2] as BookmarkFilters;
      queryClient.setQueryData<Pages>(key, {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.flatMap((item) => transform(item, filters) ?? []),
        })),
      });
    }
    return snapshot;
  }

  const handlers = {
    onError: (_error: unknown, _variables: unknown, snapshot: Snapshot | undefined) => {
      for (const [key, data] of snapshot ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks }),
  };

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateBookmarkRequest }) =>
      updateBookmark(id, patch),
    onMutate: ({ id, patch }) =>
      updateCachedLists((item, filters) => {
        if (item.id !== id) return item;
        const next = applyPatch(item, patch);
        return matchesView(next, filters.view) ? next : null;
      }),
    ...handlers,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBookmark(id),
    onMutate: (id) => updateCachedLists((item) => (item.id === id ? null : item)),
    ...handlers,
  });

  return { update, remove };
}
