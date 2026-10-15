import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, errorMessage, getJson, patchJson, postJson } from './http';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(response: Response) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

/** The rejection reason, so tests can assert on errors that are not ApiErrors too. */
function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the request to fail');
    },
    (error: unknown) => error,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('requests', () => {
  it('sends a GET that accepts JSON and resolves with the parsed body', async () => {
    const fetchSpy = mockFetch(jsonResponse([{ id: 1, name: 'Margherita' }]));

    await expect(getJson('/api/menu-items')).resolves.toEqual([{ id: 1, name: 'Margherita' }]);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/menu-items', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: undefined,
    });
  });

  it.each([
    ['POST', postJson],
    ['PATCH', patchJson],
  ] as const)('%s sends the body as JSON', async (method, send) => {
    const fetchSpy = mockFetch(jsonResponse({ id: 7, status: 'preparing' }, 201));

    await expect(send('/api/staff/orders/7/status', { status: 'preparing' })).resolves.toEqual({
      id: 7,
      status: 'preparing',
    });
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/staff/orders/7/status', {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"status":"preparing"}',
      signal: undefined,
    });
  });

  it('passes the abort signal to fetch', async () => {
    const fetchSpy = mockFetch(jsonResponse([]));
    const { signal } = new AbortController();

    await getJson('/api/staff/orders', { signal });

    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(signal);
  });
});

describe('failures', () => {
  it('turns an ADR 0006 error body into an ApiError with its status, code, message, and details', async () => {
    const details = { issues: [{ path: 'items.0.quantity', message: 'Too big' }] };
    mockFetch(
      jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Invalid order', details } }, 400),
    );

    const error = await failureOf(postJson('/api/orders', {}));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid order',
      details,
    });
  });

  it.each([
    [404, 'NOT_FOUND'],
    [409, 'ILLEGAL_STATUS_TRANSITION'],
    [422, 'ITEM_UNAVAILABLE'],
    [500, 'INTERNAL_ERROR'],
  ])('keeps status %i and code %s from the error body', async (status, code) => {
    mockFetch(jsonResponse({ error: { code, message: 'Nope' } }, status));

    await expect(patchJson('/api/staff/orders/7/status', {})).rejects.toMatchObject({
      status,
      code,
      message: 'Nope',
      details: undefined,
    });
  });

  it('reports NETWORK_ERROR with status 0 when fetch itself fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await failureOf(getJson('/api/staff/orders'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: "Can't reach the server. Check your connection and try again.",
    });
  });

  it('reports NETWORK_ERROR when the connection drops while the body is read', async () => {
    const dropped = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new TypeError('terminated'));
        },
      }),
    );
    mockFetch(dropped);

    await expect(getJson('/api/staff/orders')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it.each([
    ['an HTML error page', new Response('<h1>Service unavailable</h1>', { status: 503 })],
    // What the Vite dev proxy sends while the API process is down.
    ['an empty 502 from the dev proxy', new Response(null, { status: 502 })],
    ['JSON outside the error contract', jsonResponse({ message: 'Server exploded' }, 500)],
    [
      'an error code the contract does not define',
      jsonResponse({ error: { code: 'TEAPOT', message: 'No' } }, 418),
    ],
  ])('reports UNEXPECTED_RESPONSE with the status for %s', async (_case, response) => {
    mockFetch(response);

    const error = await failureOf(getJson('/api/menu-items'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: response.status,
      code: 'UNEXPECTED_RESPONSE',
      message: `The server sent an unexpected response (HTTP ${response.status}). Please try again.`,
    });
  });

  it('reports UNEXPECTED_RESPONSE for a success response that is not JSON', async () => {
    mockFetch(new Response('OK', { status: 200 }));

    await expect(getJson('/api/menu-items')).rejects.toMatchObject({
      status: 200,
      code: 'UNEXPECTED_RESPONSE',
    });
  });

  it('passes a cancelled request through as the abort, not as an outage', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    const controller = new AbortController();

    const pending = failureOf(getJson('/api/orders', { signal: controller.signal }));
    controller.abort();
    const error = await pending;

    expect(error).not.toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  it('keeps the URL, and the phone number in its query, out of every error message', async () => {
    const path = '/api/orders?phone=%2B12125550142';
    const failures = [
      () =>
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError(`Failed to fetch ${path}`)),
      () => mockFetch(new Response('<h1>Bad gateway</h1>', { status: 502 })),
      () => mockFetch(new Response('not json', { status: 200 })),
    ];

    for (const fail of failures) {
      fail();
      const error = await failureOf(getJson(path));
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).message).not.toMatch(/phone|2125550142|\/api/);
    }
  });
});

describe('errorMessage', () => {
  it("returns an ApiError's own message", () => {
    expect(errorMessage(new ApiError(404, 'NOT_FOUND', 'Menu item 9 was not found.'))).toBe(
      'Menu item 9 was not found.',
    );
  });

  it.each([
    ['a bug in the page', new TypeError("Cannot read properties of undefined (reading 'id')")],
    ['a thrown string', 'boom'],
    ['nothing', null],
  ])('returns a generic message for %s', (_case, error) => {
    expect(errorMessage(error)).toBe('Something went wrong. Please try again.');
  });
});
