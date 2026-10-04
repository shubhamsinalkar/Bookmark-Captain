'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px flex items-center border-b-2 transition-colors ${
        active
          ? 'border-ink font-semibold text-ink'
          : 'border-transparent text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
