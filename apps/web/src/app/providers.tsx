'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { ApiError } from '@/lib/api/client';

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [queryClient] = useState(() => {
    /** A 401 anywhere means the session ended (expired, or signed out in another tab). */
    const redirectOnUnauthorized = (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) {
        router.replace('/login');
        router.refresh();
      }
    };

    return new QueryClient({
      queryCache: new QueryCache({ onError: redirectOnUnauthorized }),
      mutationCache: new MutationCache({ onError: redirectOnUnauthorized }),
      defaultOptions: {
        queries: {
          // Live updates arrive over server-sent events, so avoid redundant refetches.
          staleTime: 30_000,
          refetchOnWindowFocus: false,
          retry: (failureCount, error) =>
            !(error instanceof ApiError && error.status < 500) && failureCount < 2,
        },
      },
    });
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
