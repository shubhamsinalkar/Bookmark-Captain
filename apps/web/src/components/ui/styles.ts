/** Shared Tailwind class sets, so controls look identical across the app. */

const pressable = 'transition-[background-color,border-color,color,transform] active:scale-[0.98]';

export const buttonPrimary = `inline-flex items-center justify-center gap-2 rounded-[10px] bg-ink px-4 py-2 text-sm font-semibold text-surface shadow-card hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-50 ${pressable}`;

export const buttonAccent = `inline-flex items-center justify-center gap-2 rounded-[10px] bg-accent px-4 py-2 text-sm font-semibold text-surface shadow-card hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50 ${pressable}`;

export const buttonSecondary = `inline-flex items-center justify-center gap-2 rounded-[10px] border border-rule-strong bg-surface px-4 py-2 text-sm font-medium shadow-card hover:border-ink-faint hover:bg-sunken/60 disabled:cursor-not-allowed disabled:opacity-50 ${pressable}`;

export const buttonGhost =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50';

export const buttonDanger =
  'inline-flex items-center gap-1.5 rounded-lg bg-danger-wash px-2.5 py-1.5 text-[13px] font-semibold text-danger transition-colors hover:bg-danger hover:text-surface disabled:opacity-50';

/** Square, icon-only. Always pair with an `aria-label`. */
export const iconButton =
  'inline-grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink disabled:opacity-50';

export const input =
  'w-full rounded-[10px] border border-rule-strong bg-surface px-3 py-2 text-sm text-ink shadow-card transition outline-none placeholder:text-ink-faint hover:border-ink-faint focus:border-accent focus:ring-4 focus:ring-accent/15';

/** Plain surface panel. Use for one grouped thing per page, not for every item. */
export const panel = 'rounded-2xl border border-rule bg-surface shadow-card';

/** Floating layer: menus and popovers. */
export const floating = 'rounded-xl border border-rule bg-surface p-1 shadow-float animate-pop';

export const menuItem =
  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition-colors outline-none hover:bg-sunken focus-visible:bg-sunken';

/** Small secondary line under a heading. */
export const hint = 'text-sm text-ink-soft';

export const pageTitle = 'text-[26px] leading-tight font-semibold tracking-[-0.02em]';
