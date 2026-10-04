import Link from 'next/link';

/** The Bravo flag hung vertically: a swallowtail that doubles as a bookmark ribbon. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 20" width="14" height="20" aria-hidden className={className}>
      <path d="M0 0H14V20L7 14.5L0 20Z" fill="var(--color-signal-red)" />
    </svg>
  );
}

/** `compact` keeps only the mark on small screens (the name stays for screen readers). */
export function Wordmark({ href, compact }: { href: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-2.5 rounded-sm text-[15px] font-bold tracking-tight font-stretch-118%"
    >
      <BrandMark className="-mt-1" />
      <span className={compact ? 'max-sm:sr-only' : undefined}>Bookmark Captain</span>
    </Link>
  );
}
