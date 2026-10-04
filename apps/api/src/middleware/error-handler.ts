import type { ApiErrorBody } from '@bc/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/http-error';

interface ErrorResponse {
  status: number;
  body: ApiErrorBody;
}

/** Errors raised by express.json() (body-parser) carry a `type` and an HTTP status. */
function isBodyParserError(error: unknown): error is { type: string; status: number } {
  return typeof error === 'object' && error !== null && 'type' in error && 'status' in error;
}

function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details } },
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
        },
      },
    };
  }
  if (isBodyParserError(error)) {
    if (error.type === 'entity.too.large') {
      return {
        status: 413,
        body: { error: { code: 'payload_too_large', message: 'Request body is too large' } },
      };
    }
    if (error.type === 'entity.parse.failed') {
      return {
        status: 400,
        body: { error: { code: 'bad_request', message: 'Malformed JSON body' } },
      };
    }
  }
  return {
    status: 500,
    body: { error: { code: 'internal_error', message: 'Something went wrong' } },
  };
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(HttpError.notFound('Route not found'));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  // Response already started streaming: let Express close the connection.
  if (res.headersSent) {
    next(error);
    return;
  }
  const { status, body } = toErrorResponse(error);
  if (status >= 500) {
    req.log.error({ err: error }, 'Unhandled error');
  }
  res.status(status).json(body);
};
