/** Shared Tailwind class sets, so controls look identical across the app. */

export const buttonPrimary =
  'inline-flex items-center justify-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50';

export const buttonSecondary =
  'inline-flex items-center justify-center gap-2 rounded-md border border-rule-strong bg-surface px-4 py-2 text-sm font-medium transition-colors hover:border-ink disabled:cursor-not-allowed disabled:opacity-50';

export const buttonGhost =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50';

export const buttonDanger =
  'inline-flex items-center gap-1.5 rounded-md bg-danger-wash px-2 py-1 text-[13px] font-semibold text-danger transition-colors hover:bg-danger hover:text-surface disabled:opacity-50';

export const input =
  'w-full rounded-md border border-rule-strong bg-surface px-3 py-2 text-sm text-ink transition-colors outline-none placeholder:text-ink-soft/80 hover:border-ink-soft focus:border-focus focus:ring-3 focus:ring-focus/20';

/** Plain surface panel. Use for one grouped thing per page, not for every item. */
export const panel = 'rounded-xl border border-rule bg-surface';

/** Small secondary line under a heading. */
export const hint = 'text-sm text-ink-soft';
