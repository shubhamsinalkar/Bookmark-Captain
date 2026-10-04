import type { ErrorCode } from '@bc/shared';

/** An error that maps directly to an HTTP response. Anything else thrown becomes a 500. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new HttpError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Authentication required') {
    return new HttpError(401, 'unauthorized', message);
  }

  static forbidden(message = 'Forbidden') {
    return new HttpError(403, 'forbidden', message);
  }

  static notFound(message = 'Not found') {
    return new HttpError(404, 'not_found', message);
  }

  static serviceUnavailable(message: string) {
    return new HttpError(503, 'service_unavailable', message);
  }
}
