import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DevLoginForm } from '@/components/dev-login-form';
import { SourceStack } from '@/components/landing/source-stack';
import { BrandMark } from '@/components/ui/brand';
import { GoogleLogo } from '@/components/ui/google-logo';
import { buttonSecondary, hint, panel } from '@/components/ui/styles';
import { getAuthProviders, getCurrentUser } from '@/lib/api/server';
import { PUBLIC_API_URL } from '@/lib/config';

export const metadata: Metadata = { title: 'Sign in' };

const ERROR_MESSAGES: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_failed: 'Google sign-in failed. Please try again.',
  google_unavailable: 'Google sign-in is not available right now.',
  invalid_state: 'Your sign-in session expired. Please try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  if (await getCurrentUser()) redirect('/inbox');

  const [{ error }, providers] = await Promise.all([searchParams, getAuthProviders()]);
  const errorMessage =
    typeof error === 'string'
      ? (ERROR_MESSAGES[error] ?? 'Sign-in failed. Please try again.')
      : null;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section
        aria-hidden
        className="relative hidden flex-col justify-between overflow-hidden bg-[#150c24] p-12 text-white lg:flex"
      >
        <div className="pointer-events-none absolute -top-40 -left-32 size-[34rem] rounded-full bg-[#c8358f]/35 blur-[120px]" />
        <div className="pointer-events-none absolute -right-24 -bottom-48 size-[30rem] rounded-full bg-[#5b52f0]/30 blur-[120px]" />
        <Link
          href="/"
          className="relative inline-flex items-center gap-2.5 text-[15px] font-semibold"
        >
          <BrandMark />
          Bookmark Captain
        </Link>
        <div className="relative">
          <SourceStack />
        </div>
        <p className="relative max-w-md font-display text-[2.6rem] leading-[1.05] tracking-[-0.01em] text-balance">
          Every post you saved, on every platform, in one calm inbox.
        </p>
      </section>

      <section className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <header className="mb-8">
            <BrandMark size={44} className="mb-6" />
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">
              Sign in to Bookmark Captain
            </h1>
            <p className={`${hint} mt-2`}>Every post you saved, on every platform, in one inbox.</p>
          </header>

          <div className={`${panel} space-y-5 p-6`}>
            {errorMessage && (
              <p
                role="alert"
                className="rounded-xl border border-danger/25 bg-danger-wash px-3.5 py-2.5 text-sm text-danger"
              >
                {errorMessage}
              </p>
            )}

            {providers.google && (
              <a
                href={new URL('/auth/google', PUBLIC_API_URL).toString()}
                className={`${buttonSecondary} w-full gap-2.5 py-2.5`}
              >
                <GoogleLogo />
                Continue with Google
              </a>
            )}

            {providers.google && providers.devLogin && (
              <div className="flex items-center gap-3 text-xs text-ink-soft">
                <span className="h-px flex-1 bg-rule" />
                or
                <span className="h-px flex-1 bg-rule" />
              </div>
            )}

            {providers.devLogin && <DevLoginForm />}

            {!providers.google && !providers.devLogin && (
              <p className={`${hint} text-center`}>No sign-in method is configured.</p>
            )}
          </div>

          <p className="mt-6 text-center text-sm">
            <Link
              href="/"
              className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
            >
              What is Bookmark Captain?
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
