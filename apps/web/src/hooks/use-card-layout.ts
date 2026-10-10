'use client';

import { useSyncExternalStore } from 'react';
import type { CardLayout } from '@/components/inbox/bookmark-card';

const STORAGE_KEY = 'bc:layout';
const listeners = new Set<() => void>();
/** This tab's choice, for when storage is unavailable (some private windows). */
let chosen: CardLayout | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function read(): CardLayout {
  if (chosen) return chosen;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Cards or a compact list, remembered in this browser. */
export function useCardLayout(): [CardLayout, (layout: CardLayout) => void] {
  const layout = useSyncExternalStore(subscribe, read, () => 'grid' as const);
  const setLayout = (next: CardLayout) => {
    chosen = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the choice then lasts until the page reloads.
    }
    listeners.forEach((listener) => listener());
  };
  return [layout, setLayout];
}
