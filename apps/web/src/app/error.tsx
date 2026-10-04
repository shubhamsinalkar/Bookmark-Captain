'use client';

import { useEffect } from 'react';
import { BrandMark } from '@/components/ui/brand';
import { buttonSecondary, hint } from '@/components/ui/styles';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <BrandMark className="mb-2 h-8 w-auto" />
      <h1 className="text-2xl font-bold tracking-tight font-stretch-112%">Something went wrong</h1>
      <p className={hint}>We couldn&apos;t load this page. The server may be unavailable.</p>
      <button type="button" onClick={reset} className={`${buttonSecondary} mt-3`}>
        Try again
      </button>
    </main>
  );
}
