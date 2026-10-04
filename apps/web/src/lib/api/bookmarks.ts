import type {
  ApiTokenSummary,
  Bookmark,
  BookmarkPage,
  BookmarkSource,
  BookmarkView,
  CreatedApiToken,
  IngestItem,
  IngestResult,
  Platform,
  UpdateBookmarkRequest,
} from '@bc/shared';
import { apiFetch } from './client';

export interface BookmarkFilters {
  view: BookmarkView;
  platform?: Platform | undefined;
  q?: string | undefined;
}

export const queryKeys = {
  bookmarks: ['bookmarks'] as const,
  /** Every cached bookmark list (all filters); paged `BookmarkPage` data only. */
  bookmarkLists: ['bookmarks', 'list'] as const,
  bookmarkList: (filters: BookmarkFilters) => ['bookmarks', 'list', filters] as const,
  // Under 'bookmarks', so it refreshes whenever bookmarks change.
  bookmarkSources: ['bookmarks', 'sources'] as const,
  apiTokens: ['api-tokens'] as const,
};

export async function listBookmarkSources(): Promise<BookmarkSource[]> {
  return (await apiFetch<{ sources: BookmarkSource[] }>('/bookmarks/sources')).sources;
}

export function listBookmarks(filters: BookmarkFilters, cursor?: string): Promise<BookmarkPage> {
  const params = new URLSearchParams({ view: filters.view });
  if (filters.platform) params.set('platform', filters.platform);
  if (filters.q) params.set('q', filters.q);
  if (cursor) params.set('cursor', cursor);
  return apiFetch(`/bookmarks?${params.toString()}`);
}

export function createBookmark(input: { url: string; title?: string }) {
  return apiFetch<{ bookmark: Bookmark; created: boolean }>('/bookmarks', {
    method: 'POST',
    json: input,
  });
}

export function updateBookmark(id: string, patch: UpdateBookmarkRequest) {
  return apiFetch<{ bookmark: Bookmark }>(`/bookmarks/${id}`, { method: 'PATCH', json: patch });
}

export function deleteBookmark(id: string) {
  return apiFetch<void>(`/bookmarks/${id}`, { method: 'DELETE' });
}

export function ingestBookmarks(items: IngestItem[]) {
  return apiFetch<IngestResult>('/bookmarks/ingest', { method: 'POST', json: { items } });
}

export async function listApiTokens(): Promise<ApiTokenSummary[]> {
  return (await apiFetch<{ items: ApiTokenSummary[] }>('/api-tokens')).items;
}

export function createApiToken(name: string) {
  return apiFetch<CreatedApiToken>('/api-tokens', { method: 'POST', json: { name } });
}

export function revokeApiToken(id: string) {
  return apiFetch<void>(`/api-tokens/${id}`, { method: 'DELETE' });
}
