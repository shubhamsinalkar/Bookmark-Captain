import { redirect } from 'next/navigation';
import { type ReactNode, Suspense } from 'react';
import { MobileHeader, Sidebar } from '@/components/app-shell/navigation';
import { getCurrentUser } from '@/lib/api/server';

/** Shell for every signed-in page. The API enforces auth on all data; this guards the UI. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      {/* The navigation reads the inbox view and source from the URL's search params. */}
      <Suspense fallback={<div className="hidden lg:block" />}>
        <Sidebar user={user} />
      </Suspense>
      <div className="min-w-0">
        <Suspense fallback={<div className="h-14 lg:hidden" />}>
          <MobileHeader user={user} />
        </Suspense>
        <main className="mx-auto w-full max-w-[84rem] px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10">
          {children}
        </main>
      </div>
    </div>
  );
}
