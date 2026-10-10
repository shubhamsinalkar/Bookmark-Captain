import Link from 'next/link';

/** The app icon: a white bookmark ribbon on a magenta-to-violet tile. */
export function BrandMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center bg-linear-135 from-[#c8358f] to-brand-deep shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_2px_rgb(91_20_136/0.3)] ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.3 }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5}>
        <path d="M6 2.5h12a1 1 0 0 1 1 1V22l-7-4.9L5 22V3.5a1 1 0 0 1 1-1Z" fill="#fff" />
      </svg>
    </span>
  );
}

/** `compact` keeps only the mark on small screens (the name stays for screen readers). */
export function Wordmark({ href, compact }: { href: string; compact?: boolean }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-2.5 rounded-lg text-[15px] font-semibold tracking-[-0.01em]"
    >
      <BrandMark />
      <span className={compact ? 'max-sm:sr-only' : undefined}>Bookmark Captain</span>
    </Link>
  );
}
