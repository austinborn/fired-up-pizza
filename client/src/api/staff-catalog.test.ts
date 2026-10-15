import type { MenuItem, Topping } from '@fired-up-pizza/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type RequestOptions } from './http';
import {
  createMenuItem,
  createTopping,
  fieldIssues,
  getStaffMenuItems,
  getStaffToppings,
  updateMenuItem,
  updateTopping,
} from './staff-catalog';

const margherita: MenuItem = {
  id: 2,
  name: 'Margherita',
  description: 'San Marzano tomato sauce, fresh mozzarella, basil, and extra-virgin olive oil.',
  category: 'Classic',
  basePriceCents: 1099,
  available: true,
  createdAt: '2026-10-14T23:41:39.000Z',
};
const pineapple: Topping = { id: 9, name: 'Pineapple', priceCents: 125, available: false };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return jsonResponse({ error: { code, message, details } }, status);
}

/** The rejection reason of a request that must fail. */
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

describe('staff catalog requests', () => {
  it.each([
    { name: 'getStaffMenuItems', load: getStaffMenuItems, path: '/api/staff/menu-items' },
    { name: 'getStaffToppings', load: getStaffToppings, path: '/api/staff/toppings' },
  ] satisfies {
    name: string;
    load: (options?: RequestOptions) => Promise<unknown>;
    path: string;
  }[])(
    '$name GETs $path, hidden rows included, and passes the abort signal',
    async ({ load, path }) => {
      const list = [margherita, pineapple];
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(list));
      const { signal } = new AbortController();

      await expect(load({ signal })).resolves.toEqual(list);
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(path, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
    },
  );

  it('createMenuItem POSTs the new item and resolves with the created row', async () => {
    const request = {
      name: 'Truffle Shuffle',
      description: 'Truffle cream, mushrooms, and fontina.',
      category: 'Specialty',
      basePriceCents: 1799,
    };
    const created: MenuItem = {
      ...request,
      id: 10,
      available: true,
      createdAt: margherita.createdAt,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(created, 201));

    await expect(createMenuItem(request)).resolves.toEqual(created);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/staff/menu-items', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: undefined,
    });
  });

  it('updateMenuItem PATCHes only the changes to the item id', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ...margherita, basePriceCents: 1149 }));

    await expect(updateMenuItem(2, { basePriceCents: 1149 })).resolves.toEqual({
      ...margherita,
      basePriceCents: 1149,
    });
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/staff/menu-items/2', {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"basePriceCents":1149}',
      signal: undefined,
    });
  });

  it('createTopping POSTs the new topping and resolves with the created row', async () => {
    const created: Topping = { id: 13, name: 'Jalapenos', priceCents: 125, available: true };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(created, 201));

    await expect(createTopping({ name: 'Jalapenos', priceCents: 125 })).resolves.toEqual(created);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/staff/toppings', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"name":"Jalapenos","priceCents":125}',
      signal: undefined,
    });
  });

  it('updateTopping PATCHes only the changes to the topping id', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ...pineapple, available: true }));

    await expect(updateTopping(9, { available: true })).resolves.toEqual({
      ...pineapple,
      available: true,
    });
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/staff/toppings/9', {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"available":true}',
      signal: undefined,
    });
  });

  it('rejects with the ApiError of a failed write', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      errorResponse(404, 'NOT_FOUND', 'Topping not found'),
    );

    const error = await failureOf(updateTopping(99, { available: false }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Topping not found' });
  });
});

describe('fieldIssues', () => {
  it('lists the issues of a VALIDATION_ERROR', () => {
    const issues = [
      { path: 'name', message: 'Name is required' },
      { path: 'basePriceCents', message: 'Price must be from 0 to 100000 cents' },
    ];

    expect(
      fieldIssues(new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', { issues })),
    ).toEqual(issues);
  });

  it('lists the name issue of a CONFLICT, which has the same shape', () => {
    const issues = [{ path: 'name', message: 'A topping with this name already exists' }];

    expect(
      fieldIssues(
        new ApiError(409, 'CONFLICT', 'A topping with this name already exists', { issues }),
      ),
    ).toEqual(issues);
  });

  it('skips entries that are not issues', () => {
    const issues = [
      { path: 'name', message: 'Name is required' },
      { path: 3, message: 'Not a path' },
      { path: 'category' },
      'Category is required',
      null,
    ];

    expect(
      fieldIssues(new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', { issues })),
    ).toEqual([{ path: 'name', message: 'Name is required' }]);
  });

  it.each([
    ['a NOT_FOUND error', new ApiError(404, 'NOT_FOUND', 'Menu item not found')],
    [
      'an error code whose details are not about fields',
      new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.', {
        issues: [{ path: 'name', message: 'Ignored' }],
      }),
    ],
    [
      'a network failure',
      new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection."),
    ],
    [
      'a VALIDATION_ERROR without details',
      new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed'),
    ],
    [
      'a VALIDATION_ERROR whose issues are not a list',
      new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', { issues: 'name' }),
    ],
    ['an error that is not an ApiError', new TypeError('Failed to fetch')],
    ['nothing', undefined],
  ])('is empty for %s', (_case, error) => {
    expect(fieldIssues(error)).toEqual([]);
  });
});
