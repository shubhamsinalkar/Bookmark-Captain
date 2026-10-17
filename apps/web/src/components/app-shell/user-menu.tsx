'use client';

import type { User } from '@bc/shared';
import { ChevronsUpDown, LogOut, Puzzle, Settings } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { floating, menuItem } from '@/components/ui/styles';
import { ThemePicker } from '@/components/ui/theme-picker';
import { useDismiss } from '@/hooks/use-dismiss';
import { apiFetch } from '@/lib/api/client';

export function Avatar({ user, size = 28 }: { user: User; size?: number }) {
  const displayName = user.name ?? user.email;
  return user.avatarUrl ? (
    <Image
      src={user.avatarUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full ring-1 ring-rule"
    />
  ) : (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-linear-135 from-[#c8358f] to-brand-deep font-semibold text-white uppercase"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {displayName.charAt(0)}
    </span>
  );
}

/**
 * The signed-in person, with Settings and Sign out. `wide` shows the name next to the avatar
 * (sidebar); otherwise just the avatar (phone header).
 */
export function UserMenu({ user, wide = false }: { user: User; wide?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  const displayName = user.name ?? user.email;

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST' });
    } finally {
      // Even if the request failed, leave the signed-in area; the server re-checks the session.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={wide ? undefined : 'Account'}
        onClick={() => setOpen((value) => !value)}
        className={
          wide
            ? 'flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-sunken aria-expanded:bg-sunken'
            : 'grid size-9 place-items-center rounded-full transition-opacity hover:opacity-85'
        }
      >
        <Avatar user={user} size={wide ? 30 : 30} />
        {wide && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{displayName}</span>
              {user.name && (
                <span className="block truncate text-xs text-ink-soft">{user.email}</span>
              )}
            </span>
            <ChevronsUpDown size={15} className="shrink-0 text-ink-soft" aria-hidden />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className={`${floating} absolute z-50 w-60 ${
            wide
              ? 'bottom-full left-0 mb-2 origin-bottom-left'
              : 'top-full right-0 mt-2 origin-top-right'
          }`}
        >
          {!wide && (
            <div className="border-b border-rule px-2.5 pt-1.5 pb-2.5">
              <p className="truncate text-sm font-medium">{displayName}</p>
              {user.name && <p className="truncate text-xs text-ink-soft">{user.email}</p>}
            </div>
          )}
          <Link role="menuitem" href="/settings" className={menuItem} onClick={close}>
            <Settings size={15} className="text-ink-soft" aria-hidden />
            Settings
          </Link>
          <Link role="menuitem" href="/extension/connect" className={menuItem} onClick={close}>
            <Puzzle size={15} className="text-ink-soft" aria-hidden />
            Connect the extension
          </Link>
          <div className="my-1 h-px bg-rule" />
          <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-2.5">
            <span className="text-sm text-ink">Theme</span>
            <ThemePicker inMenu />
          </div>
          <div className="my-1 h-px bg-rule" />
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => void signOut()}
            className={menuItem}
          >
            <LogOut size={15} className="text-ink-soft" aria-hidden />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
