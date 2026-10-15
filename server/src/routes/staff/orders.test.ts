import { ORDER_STATUSES, type OrderStatus } from '@fired-up-pizza/shared';
import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import type { UpdateOrderStatusRequest } from '@fired-up-pizza/shared/staff-orders-api';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import type { Db } from '../../db/connection';
import { createCatalogRepository } from '../../repositories/catalog';
import { getOrderDetails } from '../../repositories/orders';
import { transitionOrderStatus } from '../../services/order-status';
import { placeOrder } from '../../services/orders';
import type { OrderItemSelection } from '../../services/pricing';
import { createTestDatabase } from '../../test/database';
import { requireStaff } from './require-staff';

// The whole app runs against an in-memory database with the starter catalog
// (ADR 0006 rule 7). Orders are placed with the place-order service and moved
// with the order status service, so these tests hold no SQL and never write a
// status themselves (ADR 0002 rule 5, ADR 0004 rule 4).
//
// Two modules are wrapped but still run for real: requireStaff, so a test can
// refuse requests at the staff access-control hook, and getOrderDetails, so a
// test can lose an order between its status change and the read-back.
// vi.resetAllMocks() restores the real behavior after each test.
vi.mock(import('./require-staff'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, requireStaff: vi.fn(actual.requireStaff) };
});
vi.mock(import('../../repositories/orders'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getOrderDetails: vi.fn(actual.getOrderDetails) };
});

const PHONE = '+12125550142';
const OTHER_PHONE = '+13125550173';
const PLACED_AT = '2026-10-14T18:00:00.000Z';
const CHANGED_AT = '2026-10-14T18:20:00.000Z';
const UNKNOWN_ID = 9999;
const VALIDATION_FAILED = 'Request validation failed';
const STATUS_MESSAGE = 'Status must be one of placed, preparing, ready, delivered, cancelled';

/** 18:MM on the test day, as the ISO-8601 UTC string the server stores. */
function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 14, 18, minute)).toISOString();
}

// ADR 0004 rule 2, restated here instead of read from shared/src/order-status.ts.
const LEGAL_TRANSITIONS: readonly { from: OrderStatus; to: OrderStatus }[] = [
  { from: 'placed', to: 'preparing' },
  { from: 'preparing', to: 'ready' },
  { from: 'ready', to: 'delivered' },
  { from: 'placed', to: 'cancelled' },
  { from: 'preparing', to: 'cancelled' },
];

/** Every other move, named by the mistake it would be. */
const ILLEGAL_TRANSITIONS: readonly { from: OrderStatus; to: OrderStatus; kind: string }[] = [
  { from: 'placed', to: 'placed', kind: 'the current status' },
  { from: 'placed', to: 'ready', kind: 'skipping a step' },
  { from: 'placed', to: 'delivered', kind: 'skipping a step' },
  { from: 'preparing', to: 'placed', kind: 'backtracking' },
  { from: 'preparing', to: 'preparing', kind: 'the current status' },
  { from: 'preparing', to: 'delivered', kind: 'skipping a step' },
  { from: 'ready', to: 'placed', kind: 'backtracking' },
  { from: 'ready', to: 'preparing', kind: 'backtracking' },
  { from: 'ready', to: 'ready', kind: 'the current status' },
  { from: 'ready', to: 'cancelled', kind: 'cancelling a ready order' },
  { from: 'delivered', to: 'placed', kind: 'changing a delivered order' },
  { from: 'delivered', to: 'preparing', kind: 'changing a delivered order' },
  { from: 'delivered', to: 'ready', kind: 'changing a delivered order' },
  { from: 'delivered', to: 'delivered', kind: 'changing a delivered order' },
  { from: 'delivered', to: 'cancelled', kind: 'cancelling a delivered order' },
  { from: 'cancelled', to: 'placed', kind: 'changing a cancelled order' },
  { from: 'cancelled', to: 'preparing', kind: 'changing a cancelled order' },
  { from: 'cancelled', to: 'ready', kind: 'changing a cancelled order' },
  { from: 'cancelled', to: 'delivered', kind: 'changing a cancelled order' },
  { from: 'cancelled', to: 'cancelled', kind: 'changing a cancelled order' },
];

/** The legal moves that take a new order to each status. */
const PATH_TO: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: [],
  preparing: ['preparing'],
  ready: ['preparing', 'ready'],
  delivered: ['preparing', 'ready', 'delivered'],
  cancelled: ['cancelled'],
};

/** The starter catalog row with this name (CATALOG_SEED in server/src/db/seed.ts). */
function named<Row extends { name: string }>(rows: readonly Row[], name: string): Row {
  const row = rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(`The starter catalog has no row named ${name}`);
  }
  return row;
}

describe('staff order routes', () => {
  let db: Db;
  let app: Express;
  let items: OrderItemSelection[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    db = createTestDatabase({ seed: true });
    app = createApp({ db });
    const catalog = createCatalogRepository(db);
    // Two medium hand-tossed Margheritas with mushrooms.
    items = [
      {
        menuItemId: named(catalog.listMenuItems(), 'Margherita').id,
        sizeId: named(catalog.listSizes(), 'Medium').id,
        crustId: named(catalog.listCrusts(), 'Hand-Tossed').id,
        toppingIds: [named(catalog.listToppings(), 'Mushrooms').id],
        quantity: 2,
      },
    ];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetAllMocks();
    db.close();
  });

  /** Places an order at `placedAt` and returns its id. */
  function orderPlacedAt(placedAt: string, { phoneNumber = PHONE, notes = '' } = {}): number {
    vi.setSystemTime(new Date(placedAt));
    return placeOrder(db, { customer: { phoneNumber }, notes, items }).id;
  }

  /** A new order moved along legal steps to `status`, with its full audit trail. */
  function orderIn(status: OrderStatus, placedAt = PLACED_AT): number {
    const orderId = orderPlacedAt(placedAt);
    for (const step of PATH_TO[status]) {
      transitionOrderStatus(db, orderId, step);
    }
    return orderId;
  }

  /** The order as stored now, with its lines and status history. */
  function stored(orderId: number): OrderDetails | undefined {
    return getOrderDetails(db, orderId);
  }

  function getQueue(query = '') {
    return request(app).get(`/api/staff/orders${query}`);
  }

  function patchStatus(orderId: number | string, body: UpdateOrderStatusRequest | object) {
    return request(app).patch(`/api/staff/orders/${orderId}/status`).send(body);
  }

  describe('GET /api/staff/orders', () => {
    it('lists the live orders oldest first, with phone numbers, notes, items, and status events', async () => {
      // Ids follow the order the orders are placed in here, and their createdAt
      // times do not, so the result shows the sort is by createdAt.
      const ready = orderIn('ready', at(2));
      orderIn('delivered', at(3));
      const placed = orderPlacedAt(at(6), { phoneNumber: OTHER_PHONE, notes: 'Ring twice' });
      const preparing = orderIn('preparing', at(4));
      orderIn('cancelled', at(1));
      const placedFirst = orderIn('placed', at(0));

      const res = await getQueue();

      expect(res.status).toBe(200);
      expect(res.type).toBe('application/json');
      expect(
        res.body.map(({ id, status, phoneNumber, notes, createdAt }: OrderDetails) => ({
          id,
          status,
          phoneNumber,
          notes,
          createdAt,
        })),
      ).toEqual([
        { id: placedFirst, status: 'placed', phoneNumber: PHONE, notes: '', createdAt: at(0) },
        { id: ready, status: 'ready', phoneNumber: PHONE, notes: '', createdAt: at(2) },
        { id: preparing, status: 'preparing', phoneNumber: PHONE, notes: '', createdAt: at(4) },
        {
          id: placed,
          status: 'placed',
          phoneNumber: OTHER_PHONE,
          notes: 'Ring twice',
          createdAt: at(6),
        },
      ]);
      expect(res.body).toStrictEqual([placedFirst, ready, preparing, placed].map(stored));
      expect(res.body[1]).toMatchObject({
        items: [
          {
            menuItemName: 'Margherita',
            sizeName: 'Medium',
            crustName: 'Hand-Tossed',
            quantity: 2,
            toppings: [{ toppingName: 'Mushrooms' }],
          },
        ],
        statusEvents: [
          { fromStatus: null, toStatus: 'placed' },
          { fromStatus: 'placed', toStatus: 'preparing' },
          { fromStatus: 'preparing', toStatus: 'ready' },
        ],
      });
    });

    it('answers an empty list when no order is live', async () => {
      const empty = await getQueue();
      orderIn('delivered');
      orderIn('cancelled');
      const finished = await getQueue();

      expect(empty.status).toBe(200);
      expect(empty.body).toEqual([]);
      expect(finished.status).toBe(200);
      expect(finished.body).toEqual([]);
    });

    it('lists every live order, however many there are', async () => {
      // More orders than any page size a list is likely to default to. Sorted
      // oldest first, a cap would hide the newest ones.
      const orderIds = Array.from({ length: 101 }, (_, minute) => orderIn('placed', at(minute)));

      const res = await getQueue();

      expect(res.status).toBe(200);
      expect(res.body.map((order: OrderDetails) => order.id)).toEqual(orderIds);
    });

    describe('with ?statuses=', () => {
      let idOf: Record<OrderStatus, number>;

      beforeEach(() => {
        // One order in each status, placed in an order that differs from
        // their createdAt order: delivered, ready, preparing, cancelled, placed.
        const cancelled = orderIn('cancelled', at(4));
        const ready = orderIn('ready', at(2));
        const placed = orderIn('placed', at(5));
        const delivered = orderIn('delivered', at(1));
        const preparing = orderIn('preparing', at(3));
        idOf = { placed, preparing, ready, delivered, cancelled };
      });

      it.each([
        {
          name: 'no statuses (the live orders)',
          query: '',
          expected: ['ready', 'preparing', 'placed'],
        },
        { name: 'statuses=ready', query: '?statuses=ready', expected: ['ready'] },
        {
          name: 'statuses=placed,ready',
          query: '?statuses=placed,ready',
          expected: ['ready', 'placed'],
        },
        {
          name: 'statuses=delivered,cancelled',
          query: '?statuses=delivered,cancelled',
          expected: ['delivered', 'cancelled'],
        },
        {
          name: 'all five statuses in any order',
          query: '?statuses=cancelled,placed,preparing,ready,delivered',
          expected: ['delivered', 'ready', 'preparing', 'cancelled', 'placed'],
        },
        { name: 'a status listed twice', query: '?statuses=ready,ready', expected: ['ready'] },
        {
          name: 'the comma encoded as %2C',
          query: '?statuses=placed%2Cpreparing',
          expected: ['preparing', 'placed'],
        },
      ] satisfies { name: string; query: string; expected: OrderStatus[] }[])(
        'with $name, answers the matching orders oldest first',
        async ({ query, expected }) => {
          const res = await getQueue(query);

          expect(res.status).toBe(200);
          expect(res.body.map((order: OrderDetails) => order.status)).toEqual(expected);
          expect(res.body).toStrictEqual(expected.map((status) => stored(idOf[status])));
        },
      );

      it('ignores query parameters it does not know, as every schema strips them', async () => {
        const res = await getQueue(`?status=delivered&phone=${encodeURIComponent(OTHER_PHONE)}`);

        expect(res.status).toBe(200);
        expect(res.body.map((order: OrderDetails) => order.status)).toEqual([
          'ready',
          'preparing',
          'placed',
        ]);
      });

      it.each([
        { name: 'an unknown status', query: '?statuses=done', path: 'statuses.0' },
        {
          name: 'an unknown status after a known one',
          query: '?statuses=placed,done',
          path: 'statuses.1',
        },
        { name: 'an empty value', query: '?statuses=', path: 'statuses.0' },
        { name: 'a parameter with no value', query: '?statuses', path: 'statuses.0' },
        { name: 'an empty entry', query: '?statuses=placed,,ready', path: 'statuses.1' },
        { name: 'a capitalized status', query: '?statuses=Placed', path: 'statuses.0' },
        { name: 'a space after a comma', query: '?statuses=placed,%20ready', path: 'statuses.1' },
      ])('answers $name with 400 VALIDATION_ERROR naming the entry', async ({ query, path }) => {
        const res = await getQueue(query);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
          error: {
            code: 'VALIDATION_ERROR',
            message: VALIDATION_FAILED,
            details: { issues: [{ path, message: STATUS_MESSAGE }] },
          },
        });
      });

      it('answers a repeated statuses parameter with 400 VALIDATION_ERROR', async () => {
        const res = await getQueue('?statuses=placed&statuses=ready');

        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({
          code: 'VALIDATION_ERROR',
          message: VALIDATION_FAILED,
          details: {
            issues: [
              {
                path: 'statuses',
                message: 'Statuses must be sent once, as a comma-separated list',
              },
            ],
          },
        });
      });
    });
  });

  describe('PATCH /api/staff/orders/:id/status', () => {
    it('moves an order placed -> preparing -> ready -> delivered, recording each event', async () => {
      const orderId = orderPlacedAt(PLACED_AT, { notes: 'Ring twice' });
      let fromStatus: OrderStatus = 'placed';

      for (const [status, changedAt] of [
        ['preparing', at(5)],
        ['ready', at(18)],
        ['delivered', at(31)],
      ] as const) {
        const before = stored(orderId);
        vi.setSystemTime(new Date(changedAt));

        const res = await patchStatus(orderId, { status });

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({
          ...before,
          status,
          updatedAt: changedAt,
          statusEvents: [
            ...(before?.statusEvents ?? []),
            { id: expect.any(Number), fromStatus, toStatus: status, changedAt },
          ],
        });
        expect(stored(orderId)).toStrictEqual(res.body);
        const queue = await getQueue();
        expect(queue.body).toStrictEqual(status === 'delivered' ? [] : [res.body]);
        fromStatus = status;
      }

      expect(
        stored(orderId)?.statusEvents.map((event) => [event.fromStatus, event.toStatus]),
      ).toEqual([
        [null, 'placed'],
        ['placed', 'preparing'],
        ['preparing', 'ready'],
        ['ready', 'delivered'],
      ]);
    });

    it.each(['placed', 'preparing'] as const)(
      'cancels an order that is %s, which then leaves the live queue',
      async (from) => {
        const orderId = orderIn(from);
        const before = stored(orderId);
        vi.setSystemTime(new Date(CHANGED_AT));

        const res = await patchStatus(orderId, { status: 'cancelled' });

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual({
          ...before,
          status: 'cancelled',
          updatedAt: CHANGED_AT,
          statusEvents: [
            ...(before?.statusEvents ?? []),
            {
              id: expect.any(Number),
              fromStatus: from,
              toStatus: 'cancelled',
              changedAt: CHANGED_AT,
            },
          ],
        });
        expect(stored(orderId)).toStrictEqual(res.body);
        expect((await getQueue()).body).toEqual([]);
        expect((await getQueue('?statuses=cancelled')).body).toStrictEqual([res.body]);
      },
    );

    it('is checked against all 25 status pairs, each legal or illegal exactly once', () => {
      const pairs = [...LEGAL_TRANSITIONS, ...ILLEGAL_TRANSITIONS].map(
        ({ from, to }) => `${from} -> ${to}`,
      );
      const allPairs = ORDER_STATUSES.flatMap((from) =>
        ORDER_STATUSES.map((to) => `${from} -> ${to}`),
      );

      expect(pairs.toSorted()).toEqual(allPairs.toSorted());
    });

    it.each(ILLEGAL_TRANSITIONS)(
      'rejects $from -> $to ($kind) with 409 ILLEGAL_STATUS_TRANSITION and changes nothing',
      async ({ from, to }) => {
        const orderId = orderIn(from);
        const before = stored(orderId);
        vi.setSystemTime(new Date(CHANGED_AT));

        const res = await patchStatus(orderId, { status: to });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          error: {
            code: 'ILLEGAL_STATUS_TRANSITION',
            message: expect.any(String),
            details: { currentStatus: from, requestedStatus: to },
          },
        });
        expect(stored(orderId)).toStrictEqual(before);
      },
    );

    it.each([
      {
        scenario: 'two clicks on Start preparing',
        from: 'placed',
        requests: ['preparing', 'preparing'],
      },
      { scenario: 'Mark ready and Cancel', from: 'preparing', requests: ['ready', 'cancelled'] },
    ] satisfies { scenario: string; from: OrderStatus; requests: OrderStatus[] }[])(
      'when $scenario race, applies one and answers the other with 409',
      async ({ from, requests }) => {
        const orderId = orderIn(from);
        const before = stored(orderId);

        const responses = await Promise.all(
          requests.map((status) => patchStatus(orderId, { status })),
        );

        const codes = responses.map((res) => res.status);
        expect(codes.toSorted()).toEqual([200, 409]);
        const winner: OrderDetails = responses[codes.indexOf(200)]?.body;
        const loser = codes.indexOf(409);
        expect(responses[loser]?.body.error.details).toEqual({
          currentStatus: winner.status,
          requestedStatus: requests[loser],
        });
        expect(stored(orderId)).toStrictEqual(winner);
        expect(winner.statusEvents).toHaveLength((before?.statusEvents.length ?? 0) + 1);
      },
    );

    it('answers 404 NOT_FOUND for an unknown order', async () => {
      const res = await patchStatus(UNKNOWN_ID, { status: 'preparing' });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', message: `Order ${UNKNOWN_ID} not found` },
      });
      expect(stored(UNKNOWN_ID)).toBeUndefined();
    });

    it.each(['abc', '0', '-1', '1.5', '1e3', '0x10', '07', '9007199254740992'])(
      'rejects the id %s with 400 VALIDATION_ERROR and changes nothing',
      async (id) => {
        // Orders 1 to 7 exist, so an id read loosely as 1 or 7 would move one.
        const orderIds = Array.from({ length: 7 }, () => orderIn('placed'));
        const before = orderIds.map(stored);

        const res = await patchStatus(id, { status: 'preparing' });

        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({
          code: 'VALIDATION_ERROR',
          message: VALIDATION_FAILED,
          details: { issues: [{ path: 'id', message: 'Id must be a positive whole number' }] },
        });
        expect(orderIds.map(stored)).toStrictEqual(before);
      },
    );

    it.each([
      { name: 'no status', body: {}, path: 'status', message: STATUS_MESSAGE },
      {
        name: 'an unknown status',
        body: { status: 'done' },
        path: 'status',
        message: STATUS_MESSAGE,
      },
      {
        name: 'a capitalized status',
        body: { status: 'Preparing' },
        path: 'status',
        message: STATUS_MESSAGE,
      },
      { name: 'a numeric status', body: { status: 1 }, path: 'status', message: STATUS_MESSAGE },
      { name: 'a null status', body: { status: null }, path: 'status', message: STATUS_MESSAGE },
      {
        name: 'a body that is a list',
        body: [{ status: 'preparing' }],
        path: '',
        message: expect.any(String),
      },
    ])(
      'answers $name with 400 VALIDATION_ERROR and changes nothing',
      async ({ body, path, message }) => {
        const orderId = orderIn('placed');
        const before = stored(orderId);

        const res = await patchStatus(orderId, body);

        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({
          code: 'VALIDATION_ERROR',
          message: VALIDATION_FAILED,
          details: { issues: [{ path, message }] },
        });
        expect(stored(orderId)).toStrictEqual(before);
      },
    );

    it('answers a request with no body with 400 VALIDATION_ERROR', async () => {
      const orderId = orderIn('placed');
      const before = stored(orderId);

      const res = await request(app).patch(`/api/staff/orders/${orderId}/status`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(stored(orderId)).toStrictEqual(before);
    });

    it('uses only the status from the body', async () => {
      const orderId = orderIn('placed');
      vi.setSystemTime(new Date(CHANGED_AT));

      const res = await patchStatus(orderId, {
        status: 'preparing',
        id: UNKNOWN_ID,
        fromStatus: 'ready',
        updatedAt: '2000-01-01T00:00:00.000Z',
        statusEvents: [],
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: orderId, status: 'preparing', updatedAt: CHANGED_AT });
      expect(res.body.statusEvents.at(-1)).toMatchObject({
        fromStatus: 'placed',
        toStatus: 'preparing',
      });
    });

    it('answers a generic 500 when the changed order cannot be read back', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const orderId = orderIn('placed');
      vi.mocked(getOrderDetails).mockReturnValueOnce(undefined);

      const res = await patchStatus(orderId, { status: 'preparing' });

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
      });
      expect(getOrderDetails).toHaveBeenLastCalledWith(db, orderId);
    });
  });

  describe('staff access', () => {
    it('changes a status only under /api/staff', async () => {
      const orderId = orderIn('placed');
      const before = stored(orderId);

      for (const path of [
        `/api/orders/${orderId}/status`,
        `/staff/orders/${orderId}/status`,
        `/orders/${orderId}/status`,
      ]) {
        const res = await request(app).patch(path).send({ status: 'preparing' });

        expect(res.status).toBe(404);
      }
      expect(stored(orderId)).toStrictEqual(before);
    });

    it('lists the queue only under /api/staff', async () => {
      orderIn('placed');

      for (const path of ['/api/orders', '/staff/orders', '/orders']) {
        const res = await request(app).get(path);

        // /api/orders is the customer lookup, which needs a phone number.
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.text).not.toContain('5550142');
      }
    });

    it('passes both endpoints through requireStaff, the one access-control hook', async () => {
      const orderId = orderIn('placed');
      const before = stored(orderId);
      vi.mocked(requireStaff).mockImplementation((_req, res) => {
        res.sendStatus(403);
      });

      const queue = await getQueue();
      const change = await patchStatus(orderId, { status: 'preparing' });

      expect(queue.status).toBe(403);
      expect(change.status).toBe(403);
      expect(requireStaff).toHaveBeenCalledTimes(2);
      expect(stored(orderId)).toStrictEqual(before);
    });

    it('never logs a phone number (ADR 0005 rule 5)', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      const orderId = orderIn('placed');

      await getQueue();
      await getQueue('?statuses=done');
      await patchStatus(orderId, { status: 'preparing' });
      await patchStatus(orderId, { status: 'placed' });
      await patchStatus(UNKNOWN_ID, { status: 'ready' });

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });
});
