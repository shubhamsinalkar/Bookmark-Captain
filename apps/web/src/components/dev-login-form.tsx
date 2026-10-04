'use client';

import type { User } from '@bc/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api/client';
import { buttonSecondary, input } from './ui/styles';

/** Passwordless sign-in for local development only. The API refuses it in production. */
export function DevLoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (key: string) => {
      const value = form.get(key);
      return typeof value === 'string' ? value.trim() : '';
    };
    const name = field('name');

    setPending(true);
    setError(null);
    try {
      await apiFetch<{ user: User }>('/auth/dev-login', {
        method: 'POST',
        json: { email: field('email'), ...(name && { name }) },
      });
      router.replace('/inbox');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Please try again.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
      <p className="flex items-center gap-2 text-[13px] font-medium text-caution">
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
        Development sign-in, no password needed
      </p>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={input}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          Name <span className="font-normal text-ink-soft">(optional)</span>
        </span>
        <input name="name" type="text" autoComplete="name" maxLength={100} className={input} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${buttonSecondary} w-full py-2.5`}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
