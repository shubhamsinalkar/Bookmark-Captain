import type { KnownPlatform } from '@bc/shared';
import type { ReactNode } from 'react';
import { PlatformLogo } from './platform-logo';

/** Where each logo sits around the centre, in % of the box, with a slight tilt. */
const PLACES: { platform: KnownPlatform; x: number; y: number; size: number; tilt: number }[] = [
  { platform: 'x', x: 9, y: 22, size: 34, tilt: -10 },
  { platform: 'reddit', x: 84, y: 12, size: 36, tilt: 8 },
  { platform: 'youtube', x: 92, y: 66, size: 34, tilt: -6 },
  { platform: 'instagram', x: 4, y: 72, size: 32, tilt: 9 },
  { platform: 'browser', x: 30, y: 4, size: 28, tilt: 6 },
  { platform: 'linkedin', x: 68, y: 92, size: 28, tilt: -8 },
  { platform: 'github', x: 26, y: 94, size: 26, tilt: 12 },
];

/**
 * Decorative: the platforms you save from, gathered around one tile. Used for empty states
 * and the sign-in page.
 */
export function LogoOrbit({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div aria-hidden className={`relative mx-auto h-40 w-64 ${className}`}>
      <div className="absolute inset-4 rounded-full bg-[radial-gradient(closest-side,var(--color-accent-wash),transparent)]" />
      <div className="absolute inset-x-10 inset-y-6 rounded-full border border-dashed border-rule-strong/70" />
      <div className="absolute top-1/2 left-1/2 grid size-[72px] -translate-1/2 place-items-center rounded-[22px] border border-rule bg-surface shadow-lift">
        {children}
      </div>
      {PLACES.map(({ platform, x, y, size, tilt }) => (
        <span
          key={platform}
          className="absolute rounded-[10px] shadow-lift"
          style={{
            left: `${x}%`,
            top: `${y}%`,
            transform: `translate(-50%, -50%) rotate(${tilt}deg)`,
          }}
        >
          <PlatformLogo platform={platform} size={size} />
        </span>
      ))}
    </div>
  );
}
