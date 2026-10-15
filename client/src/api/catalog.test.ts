import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCrusts, getMenuItems, getSizes, getToppings } from './catalog';
import { ApiError, type RequestOptions } from './http';

const menuItems: MenuItem[] = [
  {
    id: 2,
    name: 'Margherita',
    description: 'San Marzano tomato sauce, fresh mozzarella, basil, and extra-virgin olive oil.',
    category: 'Classic',
    basePriceCents: 1099,
    available: true,
    createdAt: '2026-10-14T23:41:39.000Z',
  },
];
const sizes: Size[] = [
  { id: 1, name: 'Small', priceMultiplier: 1 },
  { id: 2, name: 'Medium', priceMultiplier: 1.25 },
];
const crusts: Crust[] = [
  { id: 1, name: 'Hand-Tossed', priceDeltaCents: 0 },
  { id: 3, name: 'Stuffed Crust', priceDeltaCents: 200 },
];
const toppings: Topping[] = [{ id: 7, name: 'Mushrooms', priceCents: 150, available: true }];

interface Fetcher {
  name: string;
  fetchList: (options?: RequestOptions) => Promise<unknown>;
  path: string;
  list: unknown[];
}

const fetchers: Fetcher[] = [
  { name: 'getMenuItems', fetchList: getMenuItems, path: '/api/menu-items', list: menuItems },
  { name: 'getSizes', fetchList: getSizes, path: '/api/sizes', list: sizes },
  { name: 'getCrusts', fetchList: getCrusts, path: '/api/crusts', list: crusts },
  { name: 'getToppings', fetchList: getToppings, path: '/api/toppings', list: toppings },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('catalog fetchers', () => {
  it.each(fetchers)(
    '$name GETs $path and resolves with the list',
    async ({ fetchList, path, list }) => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(list));
      const { signal } = new AbortController();

      await expect(fetchList({ signal })).resolves.toEqual(list);
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(path, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
    },
  );

  it.each(fetchers)(
    '$name rejects with the ApiError for a failed response',
    async ({ fetchList }) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse(
          { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
          500,
        ),
      );

      const failure = fetchList();

      await expect(failure).rejects.toBeInstanceOf(ApiError);
      await expect(failure).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    },
  );
});
