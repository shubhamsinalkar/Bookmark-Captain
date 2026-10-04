import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().nullable(),
  avatarUrl: z.url().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const devLoginInputSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(100).optional(),
});
export type DevLoginInput = z.infer<typeof devLoginInputSchema>;

/** Which sign-in methods the API currently has enabled. */
export interface AuthProviders {
  google: boolean;
  devLogin: boolean;
}
