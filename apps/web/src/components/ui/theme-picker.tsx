'use client';

import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import type { Theme } from '@/lib/theme';

const OPTIONS: { theme: Theme; label: string; Icon: LucideIcon }[] = [
  { theme: 'system', label: 'System', Icon: Monitor },
  { theme: 'light', label: 'Light', Icon: Sun },
  { theme: 'dark', label: 'Dark', Icon: Moon },
];

/**
 * Segmented System / Light / Dark switch. `inMenu` renders icon-only menu radios for the
 * account menu; otherwise a labelled radio group.
 */
export function ThemePicker({ inMenu = false }: { inMenu?: boolean }) {
  const [theme, setTheme] = useTheme();

  return (
    <div
      role={inMenu ? 'group' : 'radiogroup'}
      aria-label="Theme"
      className="inline-flex gap-0.5 rounded-[10px] bg-sunken p-0.5"
    >
      {OPTIONS.map(({ theme: option, label, Icon }) => {
        const selected = theme === option;
        return (
          <button
            key={option}
            type="button"
            role={inMenu ? 'menuitemradio' : 'radio'}
            aria-checked={selected}
            aria-label={inMenu ? label : undefined}
            title={inMenu ? label : undefined}
            onClick={() => setTheme(option)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors ${
              inMenu ? 'size-7' : 'px-3 py-1.5'
            } ${selected ? 'bg-surface text-ink shadow-card' : 'text-ink-soft hover:text-ink'}`}
          >
            <Icon size={14} aria-hidden />
            {!inMenu && label}
          </button>
        );
      })}
    </div>
  );
}
