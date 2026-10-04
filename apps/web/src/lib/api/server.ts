import 'server-only';
import { type AuthProviders, SESSION_COOKIE_NAME, type User } from '@bc/shared';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { PUBLIC_API_URL } from '../config';

/** Server-to-server calls may use a private network address for the API. */
const SERVER_API_URL = process.env.API_INTERNAL_URL || PUBLIC_API_URL;

async function serverFetch(path: string, sessionToken?: string): Promise<Response> {
  return fetch(new URL(path, SERVER_API_URL), {
    cache: 'no-store',
    headers: sessionToken ? { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` } : {},
  });
}

/**
 * The signed-in user, or null. Memoised per request, so layouts and pages can both call it.
 * Session renewal cookies are only applied on browser-to-API requests, not here.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const response = await serverFetch('/me', token);
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`GET /me failed with status ${response.status}`);

  const body = (await response.json()) as { user: User };
  return body.user;
});

export async function getAuthProviders(): Promise<AuthProviders> {
  const response = await serverFetch('/auth/providers');
  if (!response.ok) throw new Error(`GET /auth/providers failed with status ${response.status}`);
  return (await response.json()) as AuthProviders;
}
