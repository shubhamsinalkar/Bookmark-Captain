import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(254, 'Email is too long'));

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  /** Whether the account can sign in with a password (otherwise Google only). */
  hasPassword: z.boolean(),
});
export type User = z.infer<typeof userSchema>;

export const devLoginInputSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(100).optional(),
});
export type DevLoginInput = z.infer<typeof devLoginInputSchema>;

export const PASSWORD_MIN_LENGTH = 8;
/** Long enough for any passphrase, short enough that hashing it can't be used to slow the API. */
export const PASSWORD_MAX_LENGTH = 128;

/** Passwords are never trimmed or changed: what the user typed is what gets hashed. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => value.trim().length > 0, 'Password cannot be only spaces');

export const signUpInputSchema = z.object({
  email: emailSchema,
  password: newPasswordSchema,
  name: z.string().trim().min(1, 'Name cannot be blank').max(100, 'Name is too long').optional(),
});
export type SignUpInput = z.infer<typeof signUpInputSchema>;

/** Sign-in checks only the basics; the length rules apply when a password is chosen. */
export const signInInputSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Enter your password')
    .max(PASSWORD_MAX_LENGTH, 'Password is too long'),
});
export type SignInInput = z.infer<typeof signInInputSchema>;

/**
 * Setting or changing the password of the signed-in account. `currentPassword` is required
 * (and checked by the API) only when the account already has one.
 */
export const setPasswordInputSchema = z.object({
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH, 'Password is too long').optional(),
  newPassword: newPasswordSchema,
});
export type SetPasswordInput = z.infer<typeof setPasswordInputSchema>;

/** Which sign-in methods the API currently has enabled. */
export interface AuthProviders {
  google: boolean;
  password: boolean;
  devLogin: boolean;
}
