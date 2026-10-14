import type { ApiErrorBody, ApiErrorCode } from '@fired-up-pizza/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';

/** One HTTP status per error code (ADR 0006). */
export const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_PHONE_NUMBER: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ILLEGAL_STATUS_TRANSITION: 409,
  ITEM_UNAVAILABLE: 422,
  INTERNAL_ERROR: 500,
};

/**
 * The only error type routes and services throw on purpose. The error handler
 * turns it into the ADR 0006 response shape; anything else becomes a 500.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

/** Mounted after all /api routers so unknown API paths get a JSON 404. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const appError = toAppError(err);
  if (appError.status >= 500) {
    console.error(err);
  }
  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  };
  res.status(appError.status).json(body);
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (isBodyParserError(err)) {
    return new AppError(
      'VALIDATION_ERROR',
      err.type === 'entity.too.large'
        ? 'Request body is too large'
        : 'Request body must be valid JSON',
    );
  }
  // Never echo internal error messages or stack traces to clients.
  return new AppError('INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

/** express.json() rejects bad payloads with a 4xx error carrying a `type`. */
function isBodyParserError(err: unknown): err is { type: string; status: number } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    typeof err.type === 'string' &&
    'status' in err &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500
  );
}
