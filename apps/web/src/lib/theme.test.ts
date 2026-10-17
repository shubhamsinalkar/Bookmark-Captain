// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, parseTheme, THEME_STORAGE_KEY, themeScript } from './theme';

function deviceIsDark(dark: boolean) {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: dark,
    addEventListener: () => undefined,
  } as unknown as MediaQueryList);
}

/** Runs the inline <head> script the way the browser does: as standalone source. */
function runThemeScript() {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Executing the serialised script is the point.
  const run = new Function(themeScript) as () => void;
  run();
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('themeScript', () => {
  it('applies a saved choice over the device setting', () => {
    deviceIsDark(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    runThemeScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows the device without a saved choice', () => {
    deviceIsDark(true);
    runThemeScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('applyTheme', () => {
  it('resolves "system" from the device', () => {
    deviceIsDark(false);
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('parseTheme', () => {
  it('treats anything unrecognised as "system"', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('purple')).toBe('system');
    expect(parseTheme(null)).toBe('system');
  });
});
