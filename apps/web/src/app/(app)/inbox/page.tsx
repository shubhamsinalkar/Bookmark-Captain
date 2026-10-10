import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InboxView } from '@/components/inbox/inbox-view';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  // The view and source live in the URL's search params.
  return (
    <Suspense>
      <InboxView />
    </Suspense>
  );
}
