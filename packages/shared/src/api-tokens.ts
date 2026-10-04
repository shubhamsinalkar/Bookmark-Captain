import { z } from 'zod';

export const createApiTokenRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateApiTokenRequest = z.input<typeof createApiTokenRequestSchema>;

export interface ApiTokenSummary {
  id: string;
  name: string;
  /** First characters of the token, safe to display. */
  preview: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
}

export interface CreatedApiToken {
  /** Returned exactly once, at creation. Only a hash is stored. */
  token: string;
  apiToken: ApiTokenSummary;
}
