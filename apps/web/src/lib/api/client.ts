import type { ApiErrorBody, ErrorCode } from '@bc/shared';
import { PUBLIC_API_URL } from '../config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'network_error';

  constructor(status: number, code: ErrorCode | 'network_error', message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/** Browser-side API call. Sends the session cookie and normalises failures into `ApiError`. */
export async function apiFetch<T>(
  path: string,
  { json, ...init }: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (json !== undefined) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(new URL(path, PUBLIC_API_URL), {
      ...init,
      headers,
      credentials: 'include',
      ...(json !== undefined && { body: JSON.stringify(json) }),
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.');
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message);
    }
    throw new ApiError(response.status, 'internal_error', 'Unexpected server response');
  }
  return body as T;
}
