import { type Platform, platformLabel } from '@bc/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DressLine } from '@/components/landing/dress-line';
import { TryInbox } from '@/components/landing/try-inbox';
import { BrandMark, Wordmark } from '@/components/ui/brand';
import { flagName, SignalFlag } from '@/components/ui/signal-flag';
import { buttonPrimary, buttonSecondary } from '@/components/ui/styles';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = {
  title: { absolute: 'Bookmark Captain: every post you saved, in one inbox' },
};

/** `*` flies the answering pennant: it stands for any site. */
const AVAILABLE: { platform: Platform; label?: string; body: string }[] = [
  {
    platform: 'browser',
    body: 'The Chrome extension imports your bookmarks and keeps syncing as you add, edit or remove them. No extension? Upload a bookmarks.html export from Chrome, Firefox, Safari or Edge.',
  },
  {
    platform: 'x',
    body: 'Connect X once: your bookmarks come in, and anything you bookmark later follows within seconds.',
  },
  {
    platform: 'reddit',
    body: 'Connect Reddit once: your saved posts and comments come in, and anything you save later follows within seconds.',
  },
  {
    platform: 'instagram',
    body: 'Connect Instagram once: your saved posts and reels come in, and anything you save later follows within seconds.',
  },
  {
    platform: 'youtube',
    body: 'Connect YouTube once: your Watch later playlist comes in, and any video you add to it later follows within seconds.',
  },
  {
    platform: '*',
    label: 'Any other site',
    body: 'Open the page that lists your saved posts (LinkedIn, Pinterest…) and click Sync this list in the extension. It learns the page and keeps checking for new saves. Experimental.',
  },
  { platform: 'manual', body: 'Paste any web link into the inbox and it is saved.' },
];

const BUILT_IN_NEXT: Platform[] = ['github', 'linkedin'];

const STEPS = [
  {
    title: 'Sign in',
    body: 'Use your Google account. Your inbox is private to you.',
  },
  {
    title: 'Bring your bookmarks in',
    body: 'Connect the Chrome extension or upload a bookmarks.html file. Duplicates merge into one, and tracking tags like utm_source are stripped from links.',
  },
  {
    title: 'Work through the inbox',
    body: 'Open what you want to read, then mark it done, snooze it until tomorrow or next week, or archive it. New saves from Chrome show up within seconds.',
  },
];

const container = 'mx-auto max-w-6xl px-4 sm:px-6';

export default async function LandingPage() {
  // A marketing page must render even when the API is down; treat that as signed out.
  const user = await getCurrentUser().catch(() => null);
  const cta = user
    ? { href: '/inbox', label: 'Open your inbox' }
    : { href: '/login', label: 'Start your inbox' };

  return (
    <div className="overflow-x-clip">
      <header className={`${container} flex h-16 items-center justify-between gap-4`}>
        <Wordmark href="/" />
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a
            href="#how"
            className="hidden rounded-md px-3 py-2 text-ink-soft transition-colors hover:text-ink sm:block"
          >
            How it works
          </a>
          {user ? (
            <Link href="/inbox" className={buttonSecondary}>
              Open inbox
            </Link>
          ) : (
            <Link href="/login" className={buttonSecondary}>
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <main>
        <section aria-labelledby="hero-title" className="pb-20 sm:pb-28">
          <DressLine />
          <div
            className={`${container} grid items-start gap-12 pt-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:pt-10`}
          >
            <div className="max-w-xl">
              <h1
                id="hero-title"
                className="text-[clamp(2.75rem,8.5vw,5.5rem)] leading-[0.92] font-extrabold tracking-[-0.03em] text-balance font-stretch-125%"
              >
                Read what you saved.
              </h1>
              <p className="mt-7 max-w-md text-lg leading-relaxed text-ink-soft">
                Bookmark Captain gathers your browser bookmarks, X bookmarks, Reddit and Instagram
                saves, YouTube Watch later and the saved lists of other sites into one inbox, where
                you read them, snooze them for later, or clear them out.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href={cta.href} className={`${buttonPrimary} px-5 py-3 text-[15px]`}>
                  {cta.label}
                </Link>
                <a href="#how" className={`${buttonSecondary} px-5 py-3 text-[15px]`}>
                  How it works
                </a>
              </div>
            </div>
            <TryInbox />
          </div>
        </section>

        <section
          aria-labelledby="sources-title"
          className="border-y border-rule bg-surface py-20 sm:py-24"
        >
          <div className={container}>
            <div className="max-w-2xl">
              <h2
                id="sources-title"
                className="text-3xl leading-tight font-bold tracking-tight font-stretch-118% sm:text-4xl"
              >
                Every source flies its own flag
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-ink-soft">
                Each platform gets the maritime signal flag for its first letter, so you can tell
                where a save came from at a glance.
              </p>
            </div>

            <div className="mt-14 grid gap-14 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-20">
              <div>
                <h3 className="border-b border-rule pb-3 text-sm font-semibold">Works today</h3>
                <ul className="divide-y divide-rule">
                  {AVAILABLE.map(({ platform, label, body }) => (
                    <li key={platform} className="grid grid-cols-[4rem_1fr] gap-x-5 py-6">
                      <SignalFlag platform={platform} size={64} decorative className="mt-1" />
                      <div>
                        <p className="font-semibold">
                          {label ?? platformLabel(platform)}{' '}
                          <span className="ml-1 text-sm font-normal text-ink-soft">
                            {flagName(platform)}
                          </span>
                        </p>
                        <p className="mt-1.5 max-w-prose leading-relaxed text-ink-soft">{body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="border-b border-rule pb-3 text-sm font-semibold">
                  Built-in support next
                </h3>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-7 pt-6 sm:grid-cols-3">
                  {BUILT_IN_NEXT.map((platform) => (
                    <li key={platform} className="flex items-center gap-3">
                      <SignalFlag platform={platform} size={36} decorative />
                      <p className="leading-tight">
                        <span className="block text-sm font-semibold">
                          {platformLabel(platform)}
                        </span>
                        <span className="text-[13px] text-ink-soft">{flagName(platform)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-sm leading-relaxed text-ink-soft">
                  Until then, these work through Sync this list.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-4 py-20 sm:py-28">
          <div className={container}>
            <h2
              id="how-title"
              className="text-3xl leading-tight font-bold tracking-tight font-stretch-118% sm:text-4xl"
            >
              How it works
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {STEPS.map((step, index) => (
                <li key={step.title} className="border-t-2 border-ink pt-5">
                  <span
                    aria-hidden
                    className="block text-5xl leading-none font-extrabold text-rule-strong font-stretch-125%"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 max-w-sm leading-relaxed text-ink-soft">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="cta-title" className="bg-ink text-paper">
          <div
            className={`${container} flex flex-col items-start justify-between gap-8 py-16 sm:py-20 md:flex-row md:items-center`}
          >
            <h2
              id="cta-title"
              className="max-w-xl text-3xl leading-tight font-bold tracking-tight text-balance font-stretch-118% sm:text-4xl"
            >
              Start with the bookmarks you already have.
            </h2>
            <Link
              href={cta.href}
              className="inline-flex shrink-0 items-center justify-center rounded-md bg-paper px-5 py-3 text-[15px] font-semibold text-ink transition-colors hover:bg-paper/85 focus-visible:outline-paper"
            >
              {cta.label}
            </Link>
          </div>
        </section>
      </main>

      <footer className={`${container} flex flex-wrap items-center justify-between gap-4 py-8`}>
        <p className="flex items-center gap-2.5 text-sm text-ink-soft">
          <BrandMark className="h-4 w-auto" />
          Bookmark Captain
        </p>
        <nav className="flex gap-5 text-sm text-ink-soft">
          <a href="#how" className="hover:text-ink">
            How it works
          </a>
          <Link href={user ? '/inbox' : '/login'} className="hover:text-ink">
            {user ? 'Inbox' : 'Sign in'}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
