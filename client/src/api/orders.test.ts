import { apiErrorIssues } from '@fired-up-pizza/shared';
import type { OrderDetails, PlaceOrderRequest } from '@fired-up-pizza/shared/orders-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { placeOrder } from './orders';

const request: PlaceOrderRequest = {
  phoneNumber: '(212) 555-0142',
  notes: 'Extra napkins, please',
  items: [{ menuItemId: 2, sizeId: 2, crustId: 3, toppingIds: [7, 12], quantity: 2 }],
};

/** What the server stores for `request`: prices are snapshots, the phone is E.164. */
const order: OrderDetails = {
  id: 42,
  phoneNumber: '+12125550142',
  status: 'placed',
  totalCents: 3648,
  notes: 'Extra napkins, please',
  createdAt: '2026-10-15T01:05:00.000Z',
  updatedAt: '2026-10-15T01:05:00.000Z',
  items: [
    {
      id: 57,
      menuItemId: 2,
      sizeId: 2,
      crustId: 3,
      quantity: 2,
      unitPriceCents: 1824,
      menuItemName: 'Margherita',
      sizeName: 'Medium',
      crustName: 'Stuffed Crust',
      toppings: [
        { toppingId: 7, priceCents: 150, toppingName: 'Mushrooms' },
        { toppingId: 12, priceCents: 100, toppingName: 'Fresh Basil' },
      ],
    },
  ],
  statusEvents: [
    { id: 90, fromStatus: null, toStatus: 'placed', changedAt: '2026-10-15T01:05:00.000Z' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('placeOrder', () => {
  it('POSTs the request as JSON to /api/orders and resolves with the stored order', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(order, 201));
    const { signal } = new AbortController();

    await expect(placeOrder(request, { signal })).resolves.toEqual(order);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/orders', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  });

  it.each([
    {
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Request validation failed',
      details: { issues: [{ path: 'notes', message: 'Notes must be at most 500 characters' }] },
    },
    {
      code: 'INVALID_PHONE_NUMBER',
      status: 400,
      message: 'Phone number must be a valid 10-digit US or Canadian number',
      details: undefined,
    },
    {
      code: 'ITEM_UNAVAILABLE',
      status: 422,
      message: 'Some of the items in this order are not available',
      details: {
        issues: [{ path: 'items.0.toppingIds.1', message: 'Topping 12 is not available' }],
      },
    },
  ])(
    'rejects $code with an ApiError that keeps its code and issues',
    async ({ code, status, message, details }) => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        jsonResponse({ error: { code, message, details } }, status),
      );

      const error: unknown = await placeOrder(request).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, code, message });
      expect(apiErrorIssues((error as ApiError).details)).toEqual(details?.issues ?? []);
    },
  );
});
