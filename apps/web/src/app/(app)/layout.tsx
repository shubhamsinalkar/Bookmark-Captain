import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppHeader } from '@/components/app-header';
import { getCurrentUser } from '@/lib/api/server';

/** Shell for every signed-in page. The API enforces auth on all data; this guards the UI. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">{children}</main>
    </>
  );
}
