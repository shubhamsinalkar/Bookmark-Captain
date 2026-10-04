'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from '@/lib/api/bookmarks';
import { PUBLIC_API_URL } from '@/lib/config';

/** Bulk imports emit one event per batch; coalesce them into a single refetch. */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * Subscribes to the API's server-sent events and refreshes bookmark queries on change,
 * so saves from the extension or another tab appear without a reload.
 */
export function useLiveBookmarks(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource(new URL('/events', PUBLIC_API_URL), { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let connectedBefore = false;

    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.bookmarks });
      }, REFRESH_DEBOUNCE_MS);
    };

    source.addEventListener('bookmarks.changed', refresh);
    // `ready` fires on every (re)connect; after a reconnect, catch up on anything missed.
    source.addEventListener('ready', () => {
      if (connectedBefore) refresh();
      connectedBefore = true;
    });

    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [queryClient]);
}
