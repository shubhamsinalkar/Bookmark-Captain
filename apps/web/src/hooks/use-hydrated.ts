'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

/**
 * False on the server and while hydrating, true afterwards. Parts of the page hydrate at
 * different times (Suspense boundaries), and one part's query can finish before another part
 * hydrates; gate shared query data behind this so the first client render matches the HTML.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
