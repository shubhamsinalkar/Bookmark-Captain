'use client';

import {
  type BookmarkCounts,
  type BookmarkView,
  type Platform,
  platformLabel,
  type User,
} from '@bc/shared';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock,
  Archive,
  CheckCheck,
  Inbox,
  Layers,
  type LucideIcon,
  Plus,
  Settings,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { BrandMark, Wordmark } from '@/components/ui/brand';
import { PlatformLogo } from '@/components/ui/platform-logo';
import { iconButton } from '@/components/ui/styles';
import { useHydrated } from '@/hooks/use-hydrated';
import { getBookmarkCounts, listBookmarkSources, queryKeys } from '@/lib/api/bookmarks';
import { inboxHref, parseInboxParams } from '@/lib/inbox-url';
import { UserMenu } from './user-menu';

const numberFormat = new Intl.NumberFormat('en');

const VIEWS: {
  view: BookmarkView;
  label: string;
  icon: LucideIcon;
  count: keyof BookmarkCounts;
}[] = [
  { view: 'inbox', label: 'Inbox', icon: Inbox, count: 'inbox' },
  { view: 'snoozed', label: 'Snoozed', icon: AlarmClock, count: 'snoozed' },
  { view: 'done', label: 'Done', icon: CheckCheck, count: 'done' },
  { view: 'archived', label: 'Archived', icon: Archive, count: 'archived' },
  { view: 'all', label: 'All', icon: Layers, count: 'all' },
];

/** Where the inbox is pointed right now, and the counts and sources to show beside it. */
function useNavigationState() {
  const pathname = usePathname();
  const location = parseInboxParams(useSearchParams());
  const counts = useQuery({ queryKey: queryKeys.bookmarkCounts, queryFn: getBookmarkCounts });
  const sources = useQuery({ queryKey: queryKeys.bookmarkSources, queryFn: listBookmarkSources });
  const hydrated = useHydrated();
  return {
    pathname,
    onInbox: pathname === '/inbox',
    ...location,
    counts: hydrated ? counts.data : undefined,
    sources: hydrated ? (sources.data ?? []) : [],
  };
}

function SidebarLink({
  href,
  active,
  icon,
  label,
  count,
  highlight = false,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number | undefined;
  /** Draws the count in the accent colour (unread items waiting). */
  highlight?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="group/link flex h-9 items-center gap-3 rounded-[10px] px-2.5 text-sm text-ink-soft transition-colors hover:bg-sunken hover:text-ink aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:text-ink aria-[current=page]:shadow-card aria-[current=page]:ring-1 aria-[current=page]:ring-rule"
    >
      <span className="grid w-5 shrink-0 place-items-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={`text-xs tabular-nums ${
            highlight
              ? 'rounded-full bg-accent px-1.5 py-px font-semibold text-surface'
              : 'text-ink-faint group-aria-[current=page]/link:text-ink-soft'
          }`}
        >
          {numberFormat.format(count)}
        </span>
      )}
    </Link>
  );
}

/** Desktop navigation: views with counts, sources with logos, and the account. */
export function Sidebar({ user }: { user: User }) {
  const { pathname, onInbox, view, source, counts, sources } = useNavigationState();

  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-rule bg-paper lg:flex">
      <div className="flex h-16 items-center px-5">
        <Wordmark href="/inbox" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-3 pt-2 pb-4">
        <nav aria-label="Views" className="space-y-0.5">
          {VIEWS.map(({ view: value, label, icon: Icon, count }) => (
            <SidebarLink
              key={value}
              href={inboxHref({ view: value, source })}
              active={onInbox && view === value}
              icon={<Icon size={17} strokeWidth={1.8} aria-hidden />}
              label={label}
              count={counts?.[count]}
              highlight={value === 'inbox' && !!counts?.unread}
            />
          ))}
        </nav>

        <nav aria-label="Sources" className="space-y-0.5">
          <p className="px-2.5 pb-1.5 text-xs font-medium text-ink-soft">Sources</p>
          <SidebarLink
            href={inboxHref({ view })}
            active={onInbox && !source}
            icon={<Layers size={17} strokeWidth={1.8} aria-hidden />}
            label="Every source"
          />
          {sources.map((item) => (
            <SidebarLink
              key={item.platform}
              href={inboxHref({ view, source: item.platform })}
              active={onInbox && source === item.platform}
              icon={<PlatformLogo platform={item.platform} size={20} />}
              label={platformLabel(item.platform)}
              count={item.count}
            />
          ))}
          <Link
            href="/settings#platforms"
            className="flex h-9 items-center gap-3 rounded-[10px] px-2.5 text-sm text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
          >
            <span className="grid size-5 place-items-center rounded-md border border-dashed border-rule-strong">
              <Plus size={13} aria-hidden />
            </span>
            Connect a platform
          </Link>
        </nav>
      </div>

      <div className="space-y-1 border-t border-rule p-3">
        <SidebarLink
          href="/settings"
          active={pathname.startsWith('/settings')}
          icon={<Settings size={17} strokeWidth={1.8} aria-hidden />}
          label="Settings"
        />
        <UserMenu user={user} wide />
      </div>
    </aside>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full border border-rule bg-surface px-3.5 text-sm font-medium text-ink-soft shadow-card transition-colors aria-[current=page]:border-ink aria-[current=page]:bg-ink aria-[current=page]:text-surface"
    >
      {children}
    </Link>
  );
}

/** Phone and tablet navigation: a top bar, then views and sources as scrolling chips. */
export function MobileHeader({ user }: { user: User }) {
  const { onInbox, view, source, counts, sources } = useNavigationState();

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-rule bg-paper/85 backdrop-blur-xl lg:hidden">
        <div className="flex h-14 items-center gap-2.5 px-4 sm:px-6">
          <Link href="/inbox" className="flex items-center gap-2.5 rounded-lg">
            <BrandMark size={28} />
            <span className="text-[15px] font-semibold tracking-[-0.01em]">Bookmark Captain</span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/settings" aria-label="Settings" className={`${iconButton} size-9`}>
              <Settings size={18} aria-hidden />
            </Link>
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      {/* Only the top bar stays pinned; the chips scroll away with the page. */}
      {onInbox && (
        <div className="space-y-2 pt-3 lg:hidden">
          <nav
            aria-label="Views"
            className="scrollbar-none flex gap-2 overflow-x-auto px-4 sm:px-6"
          >
            {VIEWS.map(({ view: value, label, count }) => (
              <Chip key={value} href={inboxHref({ view: value, source })} active={view === value}>
                {label}
                {counts && counts[count] > 0 && (
                  <span className="text-xs tabular-nums opacity-70">
                    {numberFormat.format(counts[count])}
                  </span>
                )}
              </Chip>
            ))}
          </nav>
          {sources.length > 0 && (
            <nav
              aria-label="Sources"
              className="scrollbar-none flex gap-2 overflow-x-auto px-4 sm:px-6"
            >
              <Chip href={inboxHref({ view })} active={!source}>
                Every source
              </Chip>
              {sources.map((item) => (
                <SourceChip
                  key={item.platform}
                  platform={item.platform}
                  view={view}
                  active={source === item.platform}
                />
              ))}
            </nav>
          )}
        </div>
      )}
    </>
  );
}

function SourceChip({
  platform,
  view,
  active,
}: {
  platform: Platform;
  view: BookmarkView;
  active: boolean;
}) {
  return (
    <Chip href={inboxHref({ view, source: platform })} active={active}>
      <PlatformLogo platform={platform} size={18} />
      {platformLabel(platform)}
    </Chip>
  );
}
