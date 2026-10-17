'use client';

import { useSyncExternalStore } from 'react';
import { applyTheme, parseTheme, type Theme, THEME_STORAGE_KEY } from '@/lib/theme';

const listeners = new Set<() => void>();
/** This tab's choice, for when storage is unavailable (some private windows). */
let chosen: Theme | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function read(): Theme {
  if (chosen) return chosen;
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Light, dark, or following the device; remembered in this browser. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, read, () => 'system' as const);
  const setTheme = (next: Theme) => {
    chosen = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the choice then lasts until the page reloads.
    }
    applyTheme(next);
    listeners.forEach((listener) => listener());
  };
  return [theme, setTheme];
}
