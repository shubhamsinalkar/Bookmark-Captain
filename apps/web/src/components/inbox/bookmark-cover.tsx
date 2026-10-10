'use client';

import type { Bookmark } from '@bc/shared';
import { type CSSProperties, useState } from 'react';
import { SourceIcon } from '@/components/ui/platform-logo';
import { displayHost } from '@/lib/format';
import { hueFor, thumbnailFor } from '@/lib/thumbnail';

type CoverBookmark = Pick<Bookmark, 'platform' | 'url' | 'thumbnailUrl'>;

/** The bookmark's picture, or null when it has none or it failed to load. */
export function useThumbnail(bookmark: CoverBookmark) {
  const src = thumbnailFor(bookmark);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return {
    src: src && src !== failedSrc ? src : null,
    onError: () => setFailedSrc(src),
  };
}

/**
 * The top of a card: the post's or page's picture, or, for links without one, the site's icon
 * on a tint of its own.
 */
export function BookmarkCover({ bookmark }: { bookmark: CoverBookmark }) {
  const { src, onError } = useThumbnail(bookmark);
  const host = displayHost(bookmark.url);

  if (src) {
    return (
      <>
        {/* Pictures come from any site the bookmark points to. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={onError}
          className="size-full object-cover transition-transform duration-500 ease-out can-hover:group-hover:scale-[1.03]"
        />
      </>
    );
  }

  return (
    <div
      className="cover-tint relative grid size-full place-items-center"
      style={{ '--hue': hueFor(host) } as CSSProperties}
    >
      <span className="rounded-[18px] bg-surface/70 p-2 shadow-lift backdrop-blur-sm">
        <SourceIcon platform={bookmark.platform} url={bookmark.url} size={44} />
      </span>
      <span className="absolute bottom-3 left-3.5 max-w-[80%] truncate text-xs font-medium text-ink-soft">
        {host}
      </span>
    </div>
  );
}
