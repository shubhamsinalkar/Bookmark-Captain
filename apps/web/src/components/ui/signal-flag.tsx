import { type Platform, platformLabel } from '@bc/shared';
import type { ReactNode } from 'react';

/**
 * Every platform flies the International Code of Signals flag for its first letter: Bravo
 * for the browser, X-ray for X, Papa for pinterest.com, and so on, so any site anyone
 * connects gets a flag. (Ids that don't start with a letter fly the answering pennant.)
 */

const NAMES: Record<string, string> = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
};

const RED = 'var(--color-signal-red)';
const YELLOW = 'var(--color-signal-yellow)';
const BLUE = 'var(--color-signal-blue)';
const BLACK = 'var(--color-signal-black)';
const WHITE = 'var(--color-signal-white)';

// All flags are drawn on a 24 × 18 field.
const RECT = 'M0 0H24V18H0Z';
const CROSS = 'M9.5 0h5v6.5H24v5h-9.5V18h-5v-6.5H0v-5h9.5Z';
const SALTIRE = 'M0 0L24 18M24 0L0 18';
const SWALLOWTAIL = 'M0 0H24L16 9L24 18H0Z';
const PENNANT = 'M0 0L24 9L0 18Z';

const field = (color: string, d = RECT) => <path d={d} fill={color} />;

const ARTWORK: Record<string, { outline: string; art: ReactNode }> = {
  A: {
    outline: SWALLOWTAIL,
    art: (
      <>
        {field(WHITE, 'M0 0H12V18H0Z')}
        {field(BLUE, 'M12 0H24L16 9L24 18H12Z')}
      </>
    ),
  },
  B: { outline: SWALLOWTAIL, art: field(RED, SWALLOWTAIL) },
  C: {
    outline: RECT,
    art: (
      <>
        {field(WHITE)}
        {field(BLUE, 'M0 0H24V3.6H0ZM0 14.4H24V18H0Z')}
        {field(RED, 'M0 7.2H24V10.8H0Z')}
      </>
    ),
  },
  D: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW)}
        {field(BLUE, 'M0 4.5H24V13.5H0Z')}
      </>
    ),
  },
  E: {
    outline: RECT,
    art: (
      <>
        {field(BLUE, 'M0 0H24V9H0Z')}
        {field(RED, 'M0 9H24V18H0Z')}
      </>
    ),
  },
  F: {
    outline: RECT,
    art: (
      <>
        {field(WHITE)}
        {field(RED, 'M12 0L24 9L12 18L0 9Z')}
      </>
    ),
  },
  G: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW)}
        {field(BLUE, 'M4 0h4v18H4ZM12 0h4v18h-4ZM20 0h4v18h-4Z')}
      </>
    ),
  },
  H: {
    outline: RECT,
    art: (
      <>
        {field(WHITE, 'M0 0H12V18H0Z')}
        {field(RED, 'M12 0H24V18H12Z')}
      </>
    ),
  },
  I: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW)}
        <circle cx="12" cy="9" r="4.75" fill={BLACK} />
      </>
    ),
  },
  J: {
    outline: RECT,
    art: (
      <>
        {field(BLUE)}
        {field(WHITE, 'M0 6H24V12H0Z')}
      </>
    ),
  },
  K: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW, 'M0 0H12V18H0Z')}
        {field(BLUE, 'M12 0H24V18H12Z')}
      </>
    ),
  },
  L: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW)}
        {field(BLACK, 'M12 0H24V9H12ZM0 9H12V18H0Z')}
      </>
    ),
  },
  M: {
    outline: RECT,
    art: (
      <>
        {field(BLUE)}
        <path d={SALTIRE} stroke={WHITE} strokeWidth="3.6" />
      </>
    ),
  },
  N: {
    outline: RECT,
    art: (
      <>
        {field(WHITE)}
        {field(
          BLUE,
          'M0 0h6v4.5H0ZM12 0h6v4.5h-6ZM6 4.5h6V9H6ZM18 4.5h6V9h-6ZM0 9h6v4.5H0ZM12 9h6v4.5h-6ZM6 13.5h6V18H6ZM18 13.5h6V18h-6Z',
        )}
      </>
    ),
  },
  O: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW)}
        {field(RED, 'M0 0H24V18Z')}
      </>
    ),
  },
  P: {
    outline: RECT,
    art: (
      <>
        {field(BLUE)}
        {field(WHITE, 'M8 6H16V12H8Z')}
      </>
    ),
  },
  Q: { outline: RECT, art: field(YELLOW) },
  R: {
    outline: RECT,
    art: (
      <>
        {field(RED)}
        {field(YELLOW, CROSS)}
      </>
    ),
  },
  S: {
    outline: RECT,
    art: (
      <>
        {field(WHITE)}
        {field(BLUE, 'M8 6H16V12H8Z')}
      </>
    ),
  },
  T: {
    outline: RECT,
    art: (
      <>
        {field(RED, 'M0 0H8V18H0Z')}
        {field(WHITE, 'M8 0H16V18H8Z')}
        {field(BLUE, 'M16 0H24V18H16Z')}
      </>
    ),
  },
  U: {
    outline: RECT,
    art: (
      <>
        {field(WHITE)}
        {field(RED, 'M0 0H12V9H0ZM12 9H24V18H12Z')}
      </>
    ),
  },
  V: {
    outline: RECT,
    art: (
      <>
        {field(WHITE)}
        <path d={SALTIRE} stroke={RED} strokeWidth="3.6" />
      </>
    ),
  },
  W: {
    outline: RECT,
    art: (
      <>
        {field(BLUE)}
        {field(WHITE, 'M4 3H20V15H4Z')}
        {field(RED, 'M8 6H16V12H8Z')}
      </>
    ),
  },
  X: {
    outline: RECT,
    art: (
      <>
        {field(WHITE)}
        {field(BLUE, CROSS)}
      </>
    ),
  },
  Y: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW)}
        {/* Diagonal bands; the svg viewport clips the overhang. */}
        {field(
          RED,
          'M-15 18L3 0h4.5L-10.5 18ZM-6 18L12 0h4.5L-1.5 18ZM3 18L21 0h4.5L7.5 18ZM12 18L30 0h4.5L16.5 18ZM21 18L39 0h4.5L25.5 18Z',
        )}
      </>
    ),
  },
  Z: {
    outline: RECT,
    art: (
      <>
        {field(YELLOW, 'M0 0H24L12 9Z')}
        {field(BLUE, 'M24 0V18L12 9Z')}
        {field(RED, 'M24 18H0L12 9Z')}
        {field(BLACK, 'M0 18V0L12 9Z')}
      </>
    ),
  },
};

/** The answering pennant: red and white vertical bands on a tapered pennant. */
const ANSWERING = {
  outline: PENNANT,
  art: (
    <>
      {field(WHITE, PENNANT)}
      {field(RED, 'M0 0L4 1.5V16.5L0 18ZM8 3L12 4.5V13.5L8 15ZM16 6L20 7.5V10.5L16 12Z')}
    </>
  ),
};

function letterOf(platform: Platform): string | null {
  const letter = platform.charAt(0).toUpperCase();
  return letter in NAMES ? letter : null;
}

/** "Bravo" for the browser, "Papa" for pinterest.com, … */
export function flagName(platform: Platform): string {
  const letter = letterOf(platform);
  return letter ? (NAMES[letter] ?? 'Answering pennant') : 'Answering pennant';
}

interface SignalFlagProps {
  platform: Platform;
  /** Rendered width in px; height follows the 4:3 field. */
  size?: number;
  className?: string;
  /** Decorative flags are hidden from assistive tech when a text label sits next to them. */
  decorative?: boolean;
}

export function SignalFlag({ platform, size = 24, className, decorative }: SignalFlagProps) {
  const letter = letterOf(platform);
  const { outline, art } = (letter && ARTWORK[letter]) || ANSWERING;
  const label = `${platformLabel(platform)} (flag ${flagName(platform)})`;
  return (
    <svg
      viewBox="0 0 24 18"
      width={size}
      height={(size * 3) / 4}
      className={className}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      {!decorative && <title>{label}</title>}
      {art}
      {/* A hairline so white and yellow fields hold their edge on light paper. */}
      <path
        d={outline}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="0.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
