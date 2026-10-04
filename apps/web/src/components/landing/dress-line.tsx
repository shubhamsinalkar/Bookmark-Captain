import { KNOWN_PLATFORMS } from '@bc/shared';
import { SignalFlag } from '@/components/ui/signal-flag';

// The line is a quadratic curve from (0, 4) through control (500, 76) to (1000, 4) in a
// 1000 × 48 box stretched to full width (height stays 48px), so x is linear in t and
// y = 4 + 144·t·(1 − t) px. The tilt assumes a typical desktop width; it is only a hint.
const SAG = 144;
const NOMINAL_WIDTH = 1200;

/**
 * "Dressing ship": the platform flags strung on a line across the page. Decorative; the flag
 * key further down names each one.
 */
export function DressLine() {
  const count = KNOWN_PLATFORMS.length;
  return (
    <div aria-hidden className="relative h-24 text-ink-soft sm:h-32">
      <svg
        viewBox="0 0 1000 48"
        preserveAspectRatio="none"
        className="absolute inset-x-0 top-0 h-12 w-full"
      >
        <path
          d="M0 4Q500 76 1000 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {KNOWN_PLATFORMS.map((platform, index) => {
        const t = (index + 1) / (count + 1);
        const y = 4 + SAG * t * (1 - t);
        const angle = (Math.atan((SAG * (1 - 2 * t)) / NOMINAL_WIDTH) * 180) / Math.PI;
        return (
          <div
            key={platform}
            className="absolute origin-top"
            style={{
              left: `${t * 100}%`,
              top: `${y}px`,
              transform: `translateX(-50%) rotate(${angle.toFixed(1)}deg)`,
            }}
          >
            <div
              className="flex origin-top animate-hoist flex-col items-center"
              style={{ animationDelay: `${120 + index * 75}ms` }}
            >
              {/* The toggle that clips the flag to the line. */}
              <span className="h-1.5 w-px bg-current" />
              <SignalFlag
                platform={platform}
                decorative
                size={56}
                className="h-auto w-9 drop-shadow-[0_2px_0_rgb(15_42_61/0.08)] sm:w-14"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
