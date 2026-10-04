import type { ApiErrorBody, IngestItem, IngestResult, Platform, User } from '@bc/shared';
import { API_URL } from '../config';

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }

  /** Network failures, rate limits and server errors are worth retrying; client errors aren't. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

async function request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, API_URL), {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiRequestError(0, 'Could not reach Bookmark Captain');
  }

  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (payload as ApiErrorBody | null)?.error?.message ?? `Request failed (${response.status})`;
    throw new ApiRequestError(response.status, message);
  }
  return payload as T;
}

export const api = {
  me: (token: string) => request<{ user: User }>(token, 'GET', '/me'),
  ingest: (token: string, items: IngestItem[]) =>
    request<IngestResult>(token, 'POST', '/bookmarks/ingest', { items }),
  remove: (token: string, urls: string[]) =>
    request<{ removed: number }>(token, 'POST', '/bookmarks/remove', { platform: 'browser', urls }),
  removeIds: (token: string, platform: Platform, externalIds: string[]) =>
    request<{ removed: number }>(token, 'POST', '/bookmarks/remove', { platform, externalIds }),
  revokeCurrentToken: (token: string) => request<void>(token, 'DELETE', '/api-tokens/current'),
};
