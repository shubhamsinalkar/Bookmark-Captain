import type { User } from '@bc/shared';
import Image from 'next/image';
import { Wordmark } from './ui/brand';
import { NavLink } from './nav-link';
import { SignOutButton } from './sign-out-button';

export function AppHeader({ user }: { user: User }) {
  const displayName = user.name ?? user.email;

  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <Wordmark href="/inbox" compact />
          <nav className="flex h-14 items-stretch gap-4 text-sm">
            <NavLink href="/inbox">Inbox</NavLink>
            <NavLink href="/settings">Settings</NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {user.avatarUrl ? (
            <Image
              src={user.avatarUrl}
              alt=""
              width={26}
              height={26}
              className="rounded-full ring-1 ring-rule"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-6.5 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper uppercase"
            >
              {displayName.charAt(0)}
            </span>
          )}
          <span className="hidden max-w-40 truncate text-sm text-ink-soft sm:inline">
            {displayName}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
