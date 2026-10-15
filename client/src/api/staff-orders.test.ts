import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { changeOrderStatus, getLiveOrders, illegalTransition } from './staff-orders';

const createdAt = '2026-10-15T18:00:00.000Z';

const order12: OrderDetails = {
  id: 12,
  phoneNumber: '+12125550142',
  status: 'placed',
  totalCents: 1299,
  notes: 'Ring the bell twice, please.',
  createdAt,
  updatedAt: createdAt,
  items: [
    {
      id: 31,
      menuItemId: 3,
      sizeId: 2,
      crustId: 1,
      quantity: 1,
      unitPriceCents: 1299,
      menuItemName: 'Pepperoni',
      sizeName: 'Medium',
      crustName: 'Hand-Tossed',
      toppings: [],
    },
  ],
  statusEvents: [{ id: 40, fromStatus: null, toStatus: 'placed', changedAt: createdAt }],
};

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

describe('staff order requests', () => {
  it('getLiveOrders GETs the default live queue, with no statuses filter, and passes the abort signal', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([order12]));
    const { signal } = new AbortController();

    await expect(getLiveOrders({ signal })).resolves.toEqual([order12]);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/staff/orders', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
  });

  it('changeOrderStatus PATCHes the status and resolves with the order as it is now', async () => {
    const preparing: OrderDetails = {
      ...order12,
      status: 'preparing',
      updatedAt: '2026-10-15T18:04:00.000Z',
      statusEvents: [
        ...order12.statusEvents,
        {
          id: 41,
          fromStatus: 'placed',
          toStatus: 'preparing',
          changedAt: '2026-10-15T18:04:00.000Z',
        },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(preparing));

    await expect(changeOrderStatus(12, { status: 'preparing' })).resolves.toEqual(preparing);
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith('/api/staff/orders/12/status', {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"status":"preparing"}',
      signal: undefined,
    });
  });

  it('changeOrderStatus rejects a refused move with the 409 and its details', async () => {
    const details = { currentStatus: 'ready', requestedStatus: 'cancelled' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      errorResponse(409, 'ILLEGAL_STATUS_TRANSITION', 'Order 12 cannot be cancelled.', details),
    );

    const error = await failureOf(changeOrderStatus(12, { status: 'cancelled' }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'ILLEGAL_STATUS_TRANSITION', details });
    expect(illegalTransition(error)).toEqual(details);
  });
});

describe('illegalTransition', () => {
  const refused = (details: unknown) =>
    new ApiError(409, 'ILLEGAL_STATUS_TRANSITION', 'Order 12 cannot move.', details);

  it('returns the statuses a 409 ILLEGAL_STATUS_TRANSITION names', () => {
    expect(
      illegalTransition(refused({ currentStatus: 'preparing', requestedStatus: 'preparing' })),
    ).toEqual({ currentStatus: 'preparing', requestedStatus: 'preparing' });
  });

  it('leaves out a field that does not hold an order status', () => {
    expect(illegalTransition(refused({ currentStatus: 'done', requestedStatus: 'ready' }))).toEqual(
      { requestedStatus: 'ready' },
    );
    expect(illegalTransition(refused({ currentStatus: 'cancelled', requestedStatus: 7 }))).toEqual({
      currentStatus: 'cancelled',
    });
  });

  it.each([
    { name: 'no details', details: undefined },
    { name: 'details that are not an object', details: 'cancelled' },
    { name: 'null details', details: null },
  ])('returns no statuses for $name', ({ details }) => {
    expect(illegalTransition(refused(details))).toEqual({});
  });

  it.each([
    { name: 'a 409 CONFLICT', error: new ApiError(409, 'CONFLICT', 'Name taken.') },
    { name: 'a 404', error: new ApiError(404, 'NOT_FOUND', 'Order 12 was not found.') },
    { name: 'a network failure', error: new ApiError(0, 'NETWORK_ERROR', "Can't reach it.") },
    { name: 'an Error that is not an ApiError', error: new Error('ILLEGAL_STATUS_TRANSITION') },
    { name: 'a non-error', error: { code: 'ILLEGAL_STATUS_TRANSITION' } },
  ])('returns null for $name', ({ error }) => {
    expect(illegalTransition(error)).toBeNull();
  });
});
