// Error contract for every API response (ADR 0006):
//   { "error": { "code": "...", "message": "...", "details"?: ... } }
// The server maps each code to one HTTP status in server/src/http/errors.ts.

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'INVALID_PHONE_NUMBER',
  'NOT_FOUND',
  'CONFLICT',
  'ILLEGAL_STATUS_TRANSITION',
  'ITEM_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.message === 'string' &&
    (API_ERROR_CODES as readonly unknown[]).includes(error.code)
  );
}
