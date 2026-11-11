'use client';

import { setPasswordInputSchema, type User } from '@bc/shared';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useId, useRef, useState } from 'react';
import { buttonPrimary, hint, iconButton, input, panel } from '@/components/ui/styles';
import { ApiError, apiFetch } from '@/lib/api/client';

type Field = 'currentPassword' | 'newPassword';
type FieldErrors = Partial<Record<Field, string>>;

function toFieldErrors(issues: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(issues)) return errors;
  for (const issue of issues as { path?: unknown; message?: unknown }[]) {
    const path = Array.isArray(issue.path) ? issue.path.join('.') : issue.path;
    if (
      (path === 'currentPassword' || path === 'newPassword') &&
      typeof issue.message === 'string'
    ) {
      errors[path] ??= issue.message;
    }
  }
  return errors;
}

/** Add a password to an account (e.g. one made with Google), or change the existing one. */
export function PasswordSettings({ email, hasPassword }: { email: string; hasPassword: boolean }) {
  const router = useRouter();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [show, setShow] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: Field) => {
      const value = form.get(key);
      return typeof value === 'string' ? value : '';
    };
    const values = {
      ...(hasPassword && { currentPassword: text('currentPassword') }),
      newPassword: text('newPassword'),
    };

    const parsed = setPasswordInputSchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(toFieldErrors(parsed.error.issues));
      setFormError(null);
      setSaved(null);
      return;
    }
    if (hasPassword && !parsed.data.currentPassword) {
      setFieldErrors({ currentPassword: 'Enter your current password' });
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);
    setSaved(null);
    try {
      await apiFetch<{ user: User }>('/me/password', { method: 'PUT', json: parsed.data });
      formRef.current?.reset();
      setShow(false);
      setSaved(
        hasPassword
          ? 'Password changed. Other devices were signed out.'
          : `Password set. You can now sign in with ${email} and this password.`,
      );
      // Re-reads the account on the server, so the form switches to "Change password".
      router.refresh();
    } catch (err) {
      const errors = err instanceof ApiError ? toFieldErrors(err.details) : {};
      setFieldErrors(errors);
      if (Object.keys(errors).length === 0) {
        setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      }
    } finally {
      setPending(false);
    }
  }

  function field(name: Field, label: string, autoComplete: string, note?: string) {
    const error = fieldErrors[name];
    const inputId = `${id}-${name}`;
    return (
      <div className="space-y-1.5">
        <label htmlFor={inputId} className="block text-sm font-medium">
          {label}
        </label>
        <input
          id={inputId}
          name={name}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={
            error
              ? input
                  .replace('border-rule-strong', 'border-danger')
                  .replace('focus:border-accent', 'focus:border-danger')
                  .replace('focus:ring-accent/15', 'focus:ring-danger/15')
              : input
          }
        />
        {error ? (
          <p id={`${inputId}-error`} className="text-[13px] text-danger">
            {error}
          </p>
        ) : (
          note && <p className="text-[13px] text-ink-soft">{note}</p>
        )}
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className={`${panel} max-w-md p-5`}>
      <p className={hint}>
        {hasPassword
          ? 'You can sign in with your email and password, or with Google if your account is linked to it.'
          : 'Your account has no password yet: you sign in with Google. Add one to also sign in with your email.'}
      </p>
      {/* Lets password managers save the new password under the right email. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />

      <div className="mt-4 space-y-3.5">
        {hasPassword && field('currentPassword', 'Current password', 'current-password')}
        {field(
          'newPassword',
          hasPassword ? 'New password' : 'Password',
          'new-password',
          'At least 8 characters.',
        )}

        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-good">
            {saved}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className={buttonPrimary}>
            {pending ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}
          </button>
          <button
            type="button"
            onClick={() => setShow((shown) => !shown)}
            aria-label={show ? 'Hide passwords' : 'Show passwords'}
            aria-pressed={show}
            className={iconButton}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
    </form>
  );
}
