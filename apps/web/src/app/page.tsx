import { type Platform, platformLabel } from '@bc/shared';
import { ArrowRight, BrainCircuit, Keyboard, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ProductPreview } from '@/components/landing/product-preview';
import { BrandMark, Wordmark } from '@/components/ui/brand';
import { PlatformLogo } from '@/components/ui/platform-logo';
import { buttonPrimary, buttonSecondary } from '@/components/ui/styles';
import { getCurrentUser } from '@/lib/api/server';

export const metadata: Metadata = {
  title: { absolute: 'Bookmark Captain: every post you saved, in one inbox' },
};

const SOURCES: { platform: Platform; label?: string; body: string }[] = [
  {
    platform: 'browser',
    label: 'Browser bookmarks',
    body: 'The Chrome extension imports your bookmarks and follows every one you add, edit or remove. Or upload a bookmarks.html from any browser.',
  },
  {
    platform: 'x',
    body: 'Your bookmarks come in once, and anything you bookmark later follows within seconds.',
  },
  {
    platform: 'reddit',
    body: 'Saved posts and comments come in, and new saves follow within seconds.',
  },
  {
    platform: 'instagram',
    body: 'Saved posts and reels come in, and new saves follow within seconds.',
  },
  {
    platform: 'youtube',
    body: 'Your Watch later playlist comes in, and every video you add to it follows.',
  },
  {
    platform: 'manual',
    label: 'Any link',
    body: 'Paste a link into the inbox and it is saved, tidied and summarised.',
  },
];

const HERO_LOGOS: Platform[] = [
  'browser',
  'x',
  'reddit',
  'instagram',
  'youtube',
  'linkedin',
  'github',
];

const STEPS = [
  {
    title: 'Sign in',
    body: 'Use your Google account. Your inbox is private to you.',
  },
  {
    title: 'Bring your saves in',
    body: 'Connect the Chrome extension, then the platforms you use. Duplicates merge, and tracking tags like utm_source are stripped from links.',
  },
  {
    title: 'Work through them',
    body: 'Open what you want to read, then mark it done, snooze it until a better time, or archive it.',
  },
];

const container = 'mx-auto w-full max-w-6xl px-5 sm:px-8';

function Feature({
  icon,
  title,
  body,
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-3xl border border-rule bg-surface p-6 shadow-card">
      <span className="grid size-10 place-items-center rounded-xl bg-accent-wash text-accent">
        {icon}
      </span>
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.01em]">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{body}</p>
      <div aria-hidden className="mt-6 flex flex-1 items-end">
        {children}
      </div>
    </div>
  );
}

export default async function LandingPage() {
  // A marketing page must render even when the API is down; treat that as signed out.
  const user = await getCurrentUser().catch(() => null);
  const cta = user
    ? { href: '/inbox', label: 'Open your inbox' }
    : { href: '/login', label: 'Start your inbox' };

  return (
    <div className="overflow-x-clip">
      <header className={`${container} flex h-18 items-center justify-between gap-4`}>
        <Wordmark href="/" />
        <nav className="flex items-center gap-1 text-sm sm:gap-2">
          <a
            href="#how"
            className="hidden rounded-lg px-3 py-2 text-ink-soft transition-colors hover:text-ink sm:block"
          >
            How it works
          </a>
          <Link href={user ? '/inbox' : '/login'} className={`${buttonSecondary} h-9`}>
            {user ? 'Open inbox' : 'Sign in'}
          </Link>
        </nav>
      </header>

      <main>
        <section aria-labelledby="hero-title" className="pt-10 pb-20 sm:pt-16 sm:pb-28">
          <div
            className={`${container} grid items-center gap-14 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-12`}
          >
            <div className="max-w-xl animate-rise">
              <p className="inline-flex items-center gap-2 rounded-full border border-rule bg-surface px-3 py-1 text-[13px] text-ink-soft shadow-card">
                <Sparkles size={13} className="text-accent" aria-hidden />
                Summaries, topics and search by meaning
              </p>
              <h1
                id="hero-title"
                className="mt-6 font-display text-[clamp(3.25rem,8vw,5.75rem)] leading-[0.95] tracking-[-0.02em] text-balance"
              >
                Read what you saved.
              </h1>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-soft">
                Bookmark Captain gathers your browser bookmarks, X bookmarks, Reddit and Instagram
                saves and YouTube Watch later into one inbox, where you read them, snooze them, or
                clear them out.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Link href={cta.href} className={`${buttonPrimary} h-12 px-6 text-[15px]`}>
                  {cta.label}
                  <ArrowRight size={17} aria-hidden />
                </Link>
                <a href="#how" className={`${buttonSecondary} h-12 px-6 text-[15px]`}>
                  How it works
                </a>
              </div>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                <div className="flex gap-2">
                  {HERO_LOGOS.map((platform) => (
                    <PlatformLogo
                      key={platform}
                      platform={platform}
                      size={30}
                      label={platformLabel(platform)}
                    />
                  ))}
                </div>
                <p className="text-sm text-ink-soft">and any site with a saved list</p>
              </div>
            </div>
            <ProductPreview />
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
                className="font-display text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.05] tracking-[-0.01em]"
              >
                One inbox for every place you save
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-ink-soft">
                Connect once. New saves keep arriving on their own, each with its platform&apos;s
                logo, so you can tell where it came from at a glance.
              </p>
            </div>

            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SOURCES.map(({ platform, label, body }) => (
                <li
                  key={platform}
                  className="rounded-2xl border border-rule bg-paper/60 p-5 transition-colors hover:bg-paper"
                >
                  <PlatformLogo platform={platform} size={40} />
                  <p className="mt-4 font-semibold">{label ?? platformLabel(platform)}</p>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-8 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <span className="font-medium text-ink">Any other site:</span>
              open the page that lists your saves (LinkedIn, Pinterest…) and click Sync this list in
              the extension. It learns the page and keeps checking.
            </p>
          </div>
        </section>

        <section aria-labelledby="features-title" className="py-20 sm:py-28">
          <div className={container}>
            <h2
              id="features-title"
              className="max-w-2xl font-display text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.05] tracking-[-0.01em]"
            >
              Built for getting through it, not just keeping it
            </h2>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              <Feature
                icon={<Sparkles size={19} aria-hidden />}
                title="A summary on every save"
                body="Each bookmark gets a two-line summary, topics, and an estimate of how long it takes to read or watch."
              >
                <div className="w-full rounded-xl border border-rule bg-paper p-3.5 text-[13px]">
                  <p className="leading-relaxed text-ink-soft">
                    <Sparkles size={12} className="mr-1 inline text-accent" />
                    Finds slow queries with pg_stat_statements and adds a partial index.
                  </p>
                  <p className="mt-2.5 flex gap-1.5">
                    {['postgres', 'performance'].map((topic) => (
                      <span
                        key={topic}
                        className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-soft"
                      >
                        {topic}
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-ink-soft">6 min</span>
                  </p>
                </div>
              </Feature>
              <Feature
                icon={<BrainCircuit size={19} aria-hidden />}
                title="Search by meaning"
                body="Find the thread about making Postgres faster even if you only remember the idea, not the words."
              >
                <div className="w-full space-y-2 text-[13px]">
                  <p className="rounded-xl border border-accent/50 bg-surface px-3 py-2 text-ink shadow-card ring-4 ring-accent/10">
                    speed up my database
                  </p>
                  <p className="flex items-center gap-2 rounded-xl border border-rule bg-paper px-3 py-2">
                    <PlatformLogo platform="x" size={18} />
                    <span className="truncate">How we cut our Postgres p99…</span>
                  </p>
                </div>
              </Feature>
              <Feature
                icon={<Keyboard size={19} aria-hidden />}
                title="Triage at keyboard speed"
                body="Move with J and K, then E for done, S to snooze until tomorrow, A to archive. Every action can be undone."
              >
                <div className="flex w-full flex-wrap gap-2">
                  {['J', 'K', 'E', 'S', 'A', 'Z'].map((key) => (
                    <kbd
                      key={key}
                      className="grid size-10 place-items-center rounded-xl border border-rule border-b-[3px] bg-surface font-sans text-sm font-semibold shadow-card"
                    >
                      {key}
                    </kbd>
                  ))}
                </div>
              </Feature>
            </div>
          </div>
        </section>

        <section
          id="how"
          aria-labelledby="how-title"
          className="scroll-mt-4 border-t border-rule py-20 sm:py-28"
        >
          <div className={container}>
            <h2
              id="how-title"
              className="font-display text-[clamp(2.25rem,5vw,3.25rem)] leading-[1.05] tracking-[-0.01em]"
            >
              How it works
            </h2>
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {STEPS.map((step, index) => (
                <li key={step.title} className="border-t border-ink pt-5">
                  <span
                    aria-hidden
                    className="block font-display text-5xl leading-none text-ink-faint"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 max-w-sm leading-relaxed text-ink-soft">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="cta-title" className={`${container} pb-20 sm:pb-28`}>
          <div className="relative overflow-hidden rounded-[2rem] bg-[#150c24] px-6 py-14 text-white sm:px-14 sm:py-16">
            <div className="pointer-events-none absolute -top-32 -right-20 size-[28rem] rounded-full bg-[#c8358f]/40 blur-[110px]" />
            <div className="pointer-events-none absolute -bottom-40 -left-10 size-[24rem] rounded-full bg-[#5b52f0]/30 blur-[110px]" />
            <div className="relative flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
              <h2
                id="cta-title"
                className="max-w-xl font-display text-[clamp(2.25rem,5vw,3.5rem)] leading-[1.02] text-balance"
              >
                Start with the bookmarks you already have.
              </h2>
              <Link
                href={cta.href}
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-6 text-[15px] font-semibold text-[#150c24] transition-transform hover:scale-[1.02] focus-visible:outline-white active:scale-[0.98]"
              >
                {cta.label}
                <ArrowRight size={17} aria-hidden />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer
        className={`${container} flex flex-wrap items-center justify-between gap-4 border-t border-rule py-8`}
      >
        <p className="flex items-center gap-2.5 text-sm text-ink-soft">
          <BrandMark size={20} />
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
