import { isApiErrorBody, type ApiErrorCode } from '@fired-up-pizza/shared';

// The one HTTP helper (ADR 0007 rule 3). The typed per-resource functions in
// client/src/api/ are built on getJson / postJson / patchJson; components and
// hooks never call fetch themselves. Every failure is an ApiError:
// - a response in the ADR 0006 error shape keeps its status, code, message,
//   and details;
// - no response at all (offline, server down) is NETWORK_ERROR, status 0;
// - any other response the contract does not allow, such as a proxy's error
//   page or a success body that is not JSON, is UNEXPECTED_RESPONSE.
// Messages never include the URL, because customer order lookups carry the
// phone number in the query string (ADR 0005 rule 5).

/** Failures the client reports itself, for responses with no ADR 0006 error body. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE';

export class ApiError extends Error {
  /** The HTTP status, or 0 when no response arrived. */
  readonly status: number;
  readonly code: ApiErrorCode | ClientErrorCode;
  /** The error body's `details`, e.g. `{ issues }` for VALIDATION_ERROR. */
  readonly details: unknown;

  constructor(
    status: number,
    code: ApiErrorCode | ClientErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Matches the server's message for INTERNAL_ERROR. */
const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/**
 * Text a view can show for a failure: an ApiError's own message, which the
 * API and this module write for users, or a generic one for anything else,
 * such as a bug in the page, whose message is not meant for users.
 */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : GENERIC_ERROR_MESSAGE;
}

/** Requests go only to same-origin /api URLs, which Vite proxies to the API (ADR 0001 rule 7). */
export type ApiPath = `/api/${string}`;

export interface RequestOptions {
  /** Cancels the request. The promise then rejects with the abort reason, not an ApiError. */
  signal?: AbortSignal;
}

export function getJson<T>(path: ApiPath, options?: RequestOptions): Promise<T> {
  return request<T>('GET', path, undefined, options);
}

export function postJson<T>(path: ApiPath, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('POST', path, body, options);
}

export function patchJson<T>(path: ApiPath, body: unknown, options?: RequestOptions): Promise<T> {
  return request<T>('PATCH', path, body, options);
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH',
  path: ApiPath,
  body: unknown,
  { signal }: RequestOptions = {},
): Promise<T> {
  const init: RequestInit =
    body === undefined
      ? { method, headers: { Accept: 'application/json' }, signal }
      : {
          method,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        };

  let response: Response;
  let text: string;
  try {
    response = await fetch(path, init);
    text = await response.text();
  } catch (error) {
    // The caller cancelled: pass the abort through so it never reads as an outage.
    if (signal?.aborted) {
      throw error;
    }
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      "Can't reach the server. Check your connection and try again.",
    );
  }

  const json = parseJson(text);
  if (!response.ok) {
    if (isApiErrorBody(json)) {
      const { code, message, details } = json.error;
      throw new ApiError(response.status, code, message, details);
    }
    throw unexpectedResponse(response.status);
  }
  if (json === undefined) {
    throw unexpectedResponse(response.status);
  }
  // The shared request/response types are the contract (ADR 0006 rule 6), so
  // the client trusts the body's shape instead of re-validating it.
  return json as T;
}

/** The parsed body, or undefined when it is not JSON (no JSON text parses to undefined). */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function unexpectedResponse(status: number): ApiError {
  return new ApiError(
    status,
    'UNEXPECTED_RESPONSE',
    `The server sent an unexpected response (HTTP ${status}). Please try again.`,
  );
}
