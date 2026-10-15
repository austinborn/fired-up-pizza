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

/**
 * One problem with a request, as a VALIDATION_ERROR lists them in
 * `details.issues` (ADR 0006 rule 4). ITEM_UNAVAILABLE and the staff catalog's
 * CONFLICT use the same shape. `path` is a dot-separated path into the request,
 * such as `items.0.toppingIds.1`, or '' for the request as a whole.
 */
export interface ApiErrorIssue {
  path: string;
  message: string;
}

/**
 * The issues listed in an error body's `details`, so a form can show each one
 * next to the field it is about. Empty when `details` holds no `issues` list.
 * Entries that are not issues are left out.
 */
export function apiErrorIssues(details: unknown): ApiErrorIssue[] {
  if (typeof details !== 'object' || details === null || !('issues' in details)) {
    return [];
  }
  const issues: unknown = details.issues;
  return Array.isArray(issues) ? issues.filter(isApiErrorIssue) : [];
}

function isApiErrorIssue(value: unknown): value is ApiErrorIssue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'path' in value &&
    typeof value.path === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  );
}
