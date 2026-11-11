'use client';

import { PASSWORD_MIN_LENGTH, signInInputSchema, signUpInputSchema, type User } from '@bc/shared';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api/client';
import { buttonPrimary, iconButton, input } from './ui/styles';

export type AuthMode = 'signin' | 'signup';
type Field = 'name' | 'email' | 'password';
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly string[] = ['name', 'email', 'password'] satisfies Field[];

/** Turns `[{ path, message }]` (zod issues or the API's error details) into one message per field. */
function toFieldErrors(issues: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues as { path?: unknown; message?: unknown }[]) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : issue.path;
    if (typeof path === 'string' && FIELDS.includes(path) && typeof issue.message === 'string') {
      errors[path as Field] ??= issue.message;
    }
  }
  return errors;
}

/** Email + password sign-in, or account creation when `mode` is `signup`. */
export function PasswordAuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const id = useId();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const signingUp = mode === 'signup';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: Field) => {
      const value = form.get(key);
      return typeof value === 'string' ? value : '';
    };
    const name = text('name').trim();
    const values = {
      email: text('email'),
      password: text('password'),
      ...(signingUp && name && { name }),
    };

    // Same rules as the API (both use the schemas in @bc/shared), checked here first so
    // mistakes show up instantly. The API checks again: the browser can't be trusted.
    const parsed = (signingUp ? signUpInputSchema : signInInputSchema).safeParse(values);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error.issues));
      setFormError(null);
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);
    try {
      await apiFetch<{ user: User }>(signingUp ? '/auth/signup' : '/auth/login', {
        method: 'POST',
        json: parsed.data,
      });
      router.replace('/inbox');
      router.refresh();
    } catch (err) {
      const errors = err instanceof ApiError ? toFieldErrors(err.details) : {};
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
      setPending(false);
    }
  }

  function fieldProps(field: Field) {
    const error = fieldErrors[field];
    return {
      id: `${id}-${field}`,
      name: field,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? `${id}-${field}-error` : undefined,
      // Swap the colours rather than adding classes on top: two border colours on one
      // element would leave the winner up to the stylesheet's order.
      className: error
        ? input
            .replace('border-rule-strong', 'border-danger')
            .replace('focus:border-accent', 'focus:border-danger')
            .replace('focus:ring-accent/15', 'focus:ring-danger/15')
        : input,
    };
  }

  function errorFor(field: Field) {
    const error = fieldErrors[field];
    return error ? (
      <p id={`${id}-${field}-error`} className="text-[13px] text-danger">
        {error}
      </p>
    ) : null;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5" noValidate>
      {signingUp && (
        <div className="space-y-1.5">
          <label htmlFor={`${id}-name`} className="block text-sm font-medium">
            Name <span className="font-normal text-ink-soft">(optional)</span>
          </label>
          <input {...fieldProps('name')} type="text" autoComplete="name" maxLength={100} />
          {errorFor('name')}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={`${id}-email`} className="block text-sm font-medium">
          Email
        </label>
        <input
          {...fieldProps('email')}
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
        {errorFor('email')}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${id}-password`} className="block text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            {...fieldProps('password')}
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            className={`${fieldProps('password').className} pr-11`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className={`${iconButton} absolute top-1/2 right-1.5 -translate-y-1/2`}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {errorFor('password') ??
          (signingUp && (
            <p className="text-[13px] text-ink-soft">At least {PASSWORD_MIN_LENGTH} characters.</p>
          ))}
      </div>

      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}

      <button type="submit" disabled={pending} className={`${buttonPrimary} w-full py-2.5`}>
        {signingUp
          ? pending
            ? 'Creating account…'
            : 'Create account'
          : pending
            ? 'Signing in…'
            : 'Sign in'}
      </button>

      <p className="text-center text-sm text-ink-soft">
        {signingUp ? 'Already have an account? ' : 'New to Bookmark Captain? '}
        <Link
          href={signingUp ? '/login' : '/login?mode=signup'}
          replace
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          {signingUp ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </form>
  );
}
