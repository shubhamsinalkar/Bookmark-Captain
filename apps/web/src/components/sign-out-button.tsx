'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { buttonGhost } from './ui/styles';

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await apiFetch<void>('/auth/logout', { method: 'POST' });
    } finally {
      // Even if the request failed, leave the signed-in area; the server re-checks the session.
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className={`${buttonGhost} text-sm`}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
