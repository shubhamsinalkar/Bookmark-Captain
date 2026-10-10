import type { CSSProperties } from 'react';
import { SourceIcon } from '@/components/ui/platform-logo';
import { displayHost } from '@/lib/format';
import { hueFor } from '@/lib/thumbnail';
import { SAMPLES } from './samples';

const FAN = [
  { rotate: -6, x: 0, y: 26 },
  { rotate: 3, x: 26, y: 0 },
  { rotate: -2, x: 52, y: 40 },
];

/** Decorative: three saves from different platforms, fanned like cards on a table. */
export function SourceStack() {
  return (
    <div aria-hidden className="relative h-[19rem] w-full max-w-lg">
      {SAMPLES.slice(0, 3).map((sample, index) => {
        const place = FAN[index]!;
        return (
          <div
            key={sample.id}
            className="absolute w-64 overflow-hidden rounded-2xl border border-white/10 bg-surface text-ink shadow-[0_30px_60px_-20px_rgb(0_0_0/0.6)]"
            style={{
              left: `${place.x}%`,
              top: place.y,
              transform: `rotate(${place.rotate}deg)`,
              zIndex: index,
            }}
          >
            <div
              className="cover-tint grid h-24 place-items-center"
              style={{ '--hue': hueFor(displayHost(sample.url)) } as CSSProperties}
            >
              <SourceIcon platform={sample.platform} url={sample.url} size={40} />
            </div>
            <div className="p-3.5">
              <p className="flex items-center justify-between text-xs text-ink-soft">
                <span className="font-medium">{sample.byline}</span>
                <span>{sample.age}</span>
              </p>
              <p className="mt-1 line-clamp-2 text-sm leading-snug font-semibold">{sample.title}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
