export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'bc:theme';

export function parseTheme(value: string | null | undefined): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Sets `data-theme` on <html>, which the colour tokens in globals.css key off. */
export function applyTheme(theme: Theme): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/**
 * Runs inline in <head> before the first paint, so a saved theme never flashes the other one.
 * Self-contained (it is serialised with toString): it may only use its argument and globals.
 * It also follows the device while the choice is "system", and choices made in other tabs.
 */
function initTheme(storageKey: string) {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    let choice: string | null = null;
    try {
      choice = localStorage.getItem(storageKey);
    } catch {
      // Storage unavailable (some private windows): follow the device.
    }
    const dark = choice === 'dark' || (choice !== 'light' && media.matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  };
  apply();
  media.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) apply();
  });
}

export const themeScript = `(${initTheme.toString()})(${JSON.stringify(THEME_STORAGE_KEY)})`;
