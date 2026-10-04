import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DevLoginForm } from '@/components/dev-login-form';
import { BrandMark } from '@/components/ui/brand';
import { buttonPrimary, hint, panel } from '@/components/ui/styles';
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
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-8">
          <BrandMark className="mb-5 h-8 w-auto" />
          <h1 className="text-2xl leading-tight font-bold tracking-tight font-stretch-118%">
            Sign in to Bookmark Captain
          </h1>
          <p className={`${hint} mt-2`}>Every post you saved, on every platform, in one inbox.</p>
        </header>

        <div className={`${panel} space-y-5 p-6`}>
          {errorMessage && (
            <p
              role="alert"
              className="rounded-md border border-danger/30 bg-danger-wash px-3 py-2 text-sm text-danger"
            >
              {errorMessage}
            </p>
          )}

          {providers.google && (
            <a
              href={new URL('/auth/google', PUBLIC_API_URL).toString()}
              className={`${buttonPrimary} w-full py-2.5`}
            >
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

        <p className="mt-6 text-sm">
          <Link
            href="/"
            className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
          >
            What is Bookmark Captain?
          </Link>
        </p>
      </div>
    </main>
  );
}
