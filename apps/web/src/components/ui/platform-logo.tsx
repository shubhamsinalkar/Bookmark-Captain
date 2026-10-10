'use client';

import { isKnownPlatform, type Platform, platformLabel } from '@bc/shared/constants';
import { PLATFORM_LOGOS } from '@bc/shared/logos';
import { Link2 } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { displayHost } from '@/lib/format';
import { faviconUrl, hueFor } from '@/lib/thumbnail';

interface TileProps {
  size: number;
  /** A CSS background for brand tiles; neutral tiles follow the theme. */
  background?: string | null;
  className?: string;
  /** Names the tile for screen readers; without it the tile is decorative. */
  label?: string | undefined;
  style?: CSSProperties;
  children: ReactNode;
}

function Tile({ size, background, className = '', label, style, children }: TileProps) {
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden ring-1 ring-inset ${
        background ? 'ring-black/5 dark:ring-white/10' : 'bg-surface text-ink ring-rule'
      } ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        ...(background && { background }),
        ...style,
      }}
    >
      {children}
    </span>
  );
}

interface LogoProps {
  size?: number;
  className?: string;
  /** Names the logo for screen readers; omit it when a text label sits next to the logo. */
  label?: string;
}

/** A site's own icon, or a tinted letter when it has none (or it fails to load). */
export function Favicon({ host, size = 20, className, label }: LogoProps & { host: string }) {
  const [failed, setFailed] = useState(false);
  const site = host.replace(/^www\./, '');

  if (failed || !site) {
    return (
      <Tile
        size={size}
        label={label}
        className={`letter-tint font-semibold ${className ?? ''}`}
        style={{ '--hue': hueFor(site), fontSize: size * 0.46 } as CSSProperties}
      >
        {site.charAt(0).toUpperCase() || '?'}
      </Tile>
    );
  }

  const glyph = Math.round(size * 0.62);
  return (
    <Tile size={size} label={label} className={className}>
      {/* A remote icon from any site: next/image would need every host allow-listed. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={faviconUrl(site, glyph > 32 ? 128 : 64)}
        alt=""
        width={glyph}
        height={glyph}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="rounded-[3px]"
      />
    </Tile>
  );
}

/**
 * The logo of a known platform (X, Reddit, …). Links added by hand get a link tile; any other
 * site (a domain) shows its favicon.
 */
export function PlatformLogo({
  platform,
  size = 20,
  className,
  label,
}: LogoProps & { platform: Platform }) {
  const logo = isKnownPlatform(platform) ? PLATFORM_LOGOS[platform] : undefined;

  if (logo) {
    const glyph = Math.round(size * logo.scale);
    return (
      <Tile size={size} background={logo.tile} className={className} label={label}>
        <svg viewBox="0 0 24 24" width={glyph} height={glyph} aria-hidden>
          {logo.shapes.map((shape) => (
            <path key={shape.d.slice(0, 24)} d={shape.d} fill={shape.fill} />
          ))}
        </svg>
      </Tile>
    );
  }

  if (platform === 'manual') {
    return (
      <Tile size={size} className={`text-ink-soft ${className ?? ''}`} label={label}>
        <Link2 size={Math.round(size * 0.55)} strokeWidth={2} aria-hidden />
      </Tile>
    );
  }

  return <Favicon host={platform} size={size} className={className} label={label} />;
}

/** Platforms whose own logo says more than the linked site's icon would. */
const POST_PLATFORMS = new Set(['x', 'reddit', 'instagram', 'youtube', 'linkedin', 'github']);

/**
 * The icon for one bookmark: the platform's logo for posts (an X post, a Reddit thread), or the
 * linked site's icon for links (browser bookmarks, pasted links), with a small badge for the
 * browser so you can still tell where it came from.
 */
export function SourceIcon({
  platform,
  url,
  size = 32,
  className = '',
}: {
  platform: Platform;
  url: string;
  size?: number;
  className?: string;
}) {
  const label = `From ${platformLabel(platform)}`;
  if (POST_PLATFORMS.has(platform)) {
    return <PlatformLogo platform={platform} size={size} className={className} label={label} />;
  }
  const host = displayHost(url);
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} role="img" aria-label={label}>
      <Favicon host={host} size={size} />
      {/* Too small to read under 28px, where the label says it instead. */}
      {platform === 'browser' && size >= 28 && (
        <span className="absolute -right-1.5 -bottom-1.5 rounded-[7px] bg-surface p-0.5 shadow-card">
          <PlatformLogo platform="browser" size={Math.max(14, Math.round(size * 0.44))} />
        </span>
      )}
    </span>
  );
}
