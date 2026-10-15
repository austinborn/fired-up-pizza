import {
  ORDER_STATUSES,
  type Crust,
  type MenuItem,
  type OrderStatus,
  type Size,
  type Topping,
} from '@fired-up-pizza/shared';
import type {
  OrderDetails,
  PlaceOrderItem,
  PlaceOrderRequest,
} from '@fired-up-pizza/shared/orders-api';
import type {
  CreateMenuItemRequest,
  CreateToppingRequest,
  UpdateMenuItemRequest,
  UpdateToppingRequest,
} from '@fired-up-pizza/shared/staff-catalog-api';
import type { UpdateOrderStatusRequest } from '@fired-up-pizza/shared/staff-orders-api';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import type { Db } from './db/connection';
import { createTestDatabase } from './test/database';

// End-to-end flows for the MVP: one test per Per-Feature Success Criterion in
// docs/PROJECT_MANIFEST.md, then the Security review standards on phone privacy
// and client-sent prices. Each test drives the real app (createApp on an
// in-memory, migrated database with the starter catalog, ADR 0006 rule 7)
// through a whole customer or staff journey, using only the HTTP requests the
// client pages make. The suite therefore holds no SQL and calls no service or
// repository: orders are placed with POST /api/orders and moved with the staff
// status PATCH (ADR 0004 rule 4), and the catalog changes only through the
// staff catalog endpoints.
//
// Only Date is faked, so each step happens at a known minute while Express and
// supertest keep real timers. Expected prices are worked out by hand from the
// manifest's pricing rule and the starter catalog (CATALOG_SEED in
// server/src/db/seed.ts), so the suite checks the formula instead of reusing
// shared/src/pricing.ts.

interface Customer {
  /** The phone number as the customer types it. */
  typed: string;
  /** The same number as the server stores and returns it: E.164 (ADR 0005 rule 3). */
  phoneNumber: string;
}

// Fictional numbers from the 555-01XX range.
const ALICE: Customer = { typed: '(212) 555-0142', phoneNumber: '+12125550142' };
const BOB: Customer = { typed: '312.555.0173', phoneNumber: '+13125550173' };
const CAROL: Customer = { typed: '+1 415 555 0199', phoneNumber: '+14155550199' };

/** Alice's number in each way of writing it that the identity rules accept (ADR 0005 rule 3). */
const ALICE_FORMATS = [
  '2125550142',
  '212-555-0142',
  '212.555.0142',
  '212 555 0142',
  '(212) 555-0142',
  '(212)555-0142',
  '12125550142',
  '1 212 555 0142',
  '1-212-555-0142',
  '+1 212 555 0142',
  '+1 (212) 555-0142',
  '+12125550142',
];

// The manifest's status rule, restated here as the oracle: one step forward
// along placed -> preparing -> ready -> delivered, or cancelled from placed or
// preparing. Every other move is illegal.
const LEGAL_MOVES: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  placed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** The statuses the kitchen still has to act on; delivered and cancelled orders are finished. */
const LIVE: readonly OrderStatus[] = ['placed', 'preparing', 'ready'];

const INVALID_PHONE_NUMBER = {
  error: {
    code: 'INVALID_PHONE_NUMBER',
    message: 'Phone number must be a valid 10-digit US or Canadian number',
  },
};

/** 18:MM on the evening of the tests, as the ISO-8601 UTC string the server stores. */
function at(minute: number): string {
  return new Date(Date.UTC(2026, 9, 16, 18, minute)).toISOString();
}

/** What the customer pages read before ordering: the four customer catalog endpoints. */
interface Menu {
  menuItems: MenuItem[];
  sizes: Size[];
  crusts: Crust[];
  toppings: Topping[];
}

/** A pizza as a customer builds it, by the names on the menu. */
interface PizzaChoice {
  pizza: string;
  size: string;
  crust: string;
  toppings?: readonly string[];
  quantity?: number;
}

/** The row with this name. Throws when there is none, so a missing row fails loudly. */
function named<Row extends { name: string }>(rows: readonly Row[], name: string): Row {
  const row = rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(`No row named ${name}`);
  }
  return row;
}

/** The order line the builder sends for `choice`: catalog ids and a quantity, never a price. */
function line(
  menu: Menu,
  { pizza, size, crust, toppings = [], quantity = 1 }: PizzaChoice,
): PlaceOrderItem {
  return {
    menuItemId: named(menu.menuItems, pizza).id,
    sizeId: named(menu.sizes, size).id,
    crustId: named(menu.crusts, crust).id,
    toppingIds: toppings.map((topping) => named(menu.toppings, topping).id),
    quantity,
  };
}

/**
 * `order` as it reads after staff moved it to `status` at 18:MM: the status and
 * updatedAt change, and one event is added to the history. Nothing else does,
 * prices included.
 */
function moved(order: OrderDetails, status: OrderStatus, minute: number): OrderDetails {
  return {
    ...order,
    status,
    updatedAt: at(minute),
    statusEvents: [
      ...order.statusEvents,
      { id: expect.any(Number), fromStatus: order.status, toStatus: status, changedAt: at(minute) },
    ],
  };
}

describe('MVP flows through the real app', () => {
  let db: Db;
  let app: Express;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(at(0)));
    db = createTestDatabase({ seed: true });
    app = createApp({ db });
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
  });

  /** Sets the server's clock to 18:MM. */
  function clockAt(minute: number): void {
    vi.setSystemTime(new Date(at(minute)));
  }

  /** The 200 body of GET `path`. On another status the failure shows the body. */
  async function getOk(path: string) {
    const res = await request(app).get(path);
    expect(res.status, res.text).toBe(200);
    return res.body;
  }

  // Customer requests.

  async function readMenu(): Promise<Menu> {
    return {
      menuItems: await getOk('/api/menu-items'),
      sizes: await getOk('/api/sizes'),
      crusts: await getOk('/api/crusts'),
      toppings: await getOk('/api/toppings'),
    };
  }

  /** POST /api/orders at 18:MM, as checkout sends it. */
  function postOrder(minute: number, body: unknown) {
    clockAt(minute);
    return request(app)
      .post('/api/orders')
      .send(body as object);
  }

  /** Places an order at 18:MM and returns it as the server answered (201). */
  async function placeOrderAt(minute: number, body: PlaceOrderRequest): Promise<OrderDetails> {
    const res = await postOrder(minute, body);
    expect(res.status, res.text).toBe(201);
    return res.body;
  }

  /** GET /api/orders?phone=…, as the tracking page polls it. */
  function lookUp(query: Record<string, string> | string) {
    return request(app).get('/api/orders').query(query);
  }

  /** The orders a customer sees for the number written as `phone` (200). */
  async function ordersOf(phone: string): Promise<OrderDetails[]> {
    const res = await lookUp({ phone });
    expect(res.status, res.text).toBe(200);
    return res.body;
  }

  // Staff requests.

  /** The live queue, as the staff queue page polls it. */
  async function staffQueue(): Promise<OrderDetails[]> {
    return getOk('/api/staff/orders');
  }

  /** One click on a status button at 18:MM: PATCH /api/staff/orders/:id/status. */
  function requestStatus(minute: number, orderId: number, status: OrderStatus) {
    clockAt(minute);
    const body: UpdateOrderStatusRequest = { status };
    return request(app).patch(`/api/staff/orders/${orderId}/status`).send(body);
  }

  /**
   * Staff click `order` through `steps`, each at its minute. Every click must
   * answer 200 with the order as `moved` predicts. Returns the order as the
   * last click left it.
   */
  async function work(
    order: OrderDetails,
    ...steps: (readonly [minute: number, status: OrderStatus])[]
  ): Promise<OrderDetails> {
    let expected = order;
    for (const [minute, status] of steps) {
      expected = moved(expected, status, minute);
      const res = await requestStatus(minute, order.id, status);
      expect(res.status, res.text).toBe(200);
      expect(res.body).toStrictEqual(expected);
    }
    return expected;
  }

  /** A click that the status rule forbids: 409 ILLEGAL_STATUS_TRANSITION (ADR 0004 rule 6). */
  async function expectRefused(minute: number, order: OrderDetails, status: OrderStatus) {
    const res = await requestStatus(minute, order.id, status);
    expect(res.status, `${order.status} -> ${status}`).toBe(409);
    expect(res.body).toStrictEqual({
      error: {
        code: 'ILLEGAL_STATUS_TRANSITION',
        message: expect.any(String),
        details: { currentStatus: order.status, requestedStatus: status },
      },
    });
  }

  async function createMenuItem(body: CreateMenuItemRequest): Promise<MenuItem> {
    const res = await request(app).post('/api/staff/menu-items').send(body);
    expect(res.status, res.text).toBe(201);
    return res.body;
  }

  async function createTopping(body: CreateToppingRequest): Promise<Topping> {
    const res = await request(app).post('/api/staff/toppings').send(body);
    expect(res.status, res.text).toBe(201);
    return res.body;
  }

  async function editMenuItem(id: number, changes: UpdateMenuItemRequest): Promise<MenuItem> {
    const res = await request(app).patch(`/api/staff/menu-items/${id}`).send(changes);
    expect(res.status, res.text).toBe(200);
    return res.body;
  }

  async function editTopping(id: number, changes: UpdateToppingRequest): Promise<Topping> {
    const res = await request(app).patch(`/api/staff/toppings/${id}`).send(changes);
    expect(res.status, res.text).toBe(200);
    return res.body;
  }

  describe('per-feature success criteria (docs/PROJECT_MANIFEST.md)', () => {
    it('1. a customer places a customized order (size, crust, toppings) with only a phone number', async () => {
      const menu = await readMenu();

      // Two large Margheritas on stuffed crust with mushrooms and basil, and a
      // medium Pepperoni on thin crust with red onions. The customer is named by
      // a phone number alone: no account, no login, and no prices.
      const checkout: PlaceOrderRequest = {
        phoneNumber: ALICE.typed,
        items: [
          line(menu, {
            pizza: 'Margherita',
            size: 'Large',
            crust: 'Stuffed Crust',
            toppings: ['Mushrooms', 'Fresh Basil'],
            quantity: 2,
          }),
          line(menu, {
            pizza: 'Pepperoni',
            size: 'Medium',
            crust: 'Thin & Crispy',
            toppings: ['Red Onions'],
          }),
        ],
      };
      const res = await postOrder(0, checkout);

      expect(res.status, res.text).toBe(201);
      // No session either (ADR 0005 rule 1).
      expect(res.headers['set-cookie']).toBeUndefined();
      const order: OrderDetails = res.body;
      expect(order).toStrictEqual({
        id: expect.any(Number),
        phoneNumber: ALICE.phoneNumber,
        status: 'placed',
        totalCents: 2 * 2099 + 1749,
        notes: '',
        createdAt: at(0),
        updatedAt: at(0),
        items: [
          {
            id: expect.any(Number),
            menuItemId: named(menu.menuItems, 'Margherita').id,
            menuItemName: 'Margherita',
            sizeId: named(menu.sizes, 'Large').id,
            sizeName: 'Large',
            crustId: named(menu.crusts, 'Stuffed Crust').id,
            crustName: 'Stuffed Crust',
            quantity: 2,
            // round(1099 x 1.5 = 1648.5) = 1649, + 200 crust, + 150 + 100 toppings.
            unitPriceCents: 2099,
            toppings: [
              {
                toppingId: named(menu.toppings, 'Mushrooms').id,
                toppingName: 'Mushrooms',
                priceCents: 150,
              },
              {
                toppingId: named(menu.toppings, 'Fresh Basil').id,
                toppingName: 'Fresh Basil',
                priceCents: 100,
              },
            ],
          },
          {
            id: expect.any(Number),
            menuItemId: named(menu.menuItems, 'Pepperoni').id,
            menuItemName: 'Pepperoni',
            sizeId: named(menu.sizes, 'Medium').id,
            sizeName: 'Medium',
            crustId: named(menu.crusts, 'Thin & Crispy').id,
            crustName: 'Thin & Crispy',
            quantity: 1,
            // round(1299 x 1.25 = 1623.75) = 1624, + 0 crust, + 125 topping.
            unitPriceCents: 1749,
            toppings: [
              {
                toppingId: named(menu.toppings, 'Red Onions').id,
                toppingName: 'Red Onions',
                priceCents: 125,
              },
            ],
          },
        ],
        statusEvents: [
          { id: expect.any(Number), fromStatus: null, toStatus: 'placed', changedAt: at(0) },
        ],
      });

      // No phone call needed: the kitchen's queue has the order with every
      // choice, and the customer finds it again by the same number.
      expect(await staffQueue()).toStrictEqual([order]);
      expect(await ordersOf(ALICE.typed)).toStrictEqual([order]);

      // The phone number is the one thing an order needs to say who it is for.
      const { phoneNumber: _, ...anonymous } = checkout;
      const noPhone = await postOrder(1, anonymous);
      expect(noPhone.status).toBe(400);
      expect(noPhone.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: { issues: [{ path: 'phoneNumber' }] } },
      });
      const notAPhone = await postOrder(1, { ...anonymous, phoneNumber: 'Alice' });
      expect(notAPhone.status).toBe(400);
      expect(notAPhone.body).toStrictEqual(INVALID_PHONE_NUMBER);
      expect(await staffQueue()).toStrictEqual([order]);
    });

    it('2. a customer looks up orders by phone number, in any accepted format, and sees each status change', async () => {
      const menu = await readMenu();
      const items = [line(menu, { pizza: 'Cheese', size: 'Medium', crust: 'Hand-Tossed' })];
      const first = await placeOrderAt(0, { phoneNumber: '212-555-0142', items });

      // However the customer writes the number, the lookup finds the order.
      for (const phone of ALICE_FORMATS) {
        expect(await ordersOf(phone), phone).toStrictEqual([first]);
      }

      // The tracking page polls. Each poll after a staff click shows the new
      // status, when it changed, and the history so far.
      const preparing = await work(first, [5, 'preparing']);
      expect(await ordersOf('(212) 555-0142')).toStrictEqual([preparing]);

      // A second order, cancelled at once, is listed first: newest first, each
      // order with its own status.
      const second = await placeOrderAt(10, { phoneNumber: '+1 212 555 0142', items });
      const cancelled = await work(second, [12, 'cancelled']);
      const ready = await work(preparing, [20, 'ready']);
      expect(await ordersOf('2125550142')).toStrictEqual([cancelled, ready]);

      const delivered = await work(ready, [35, 'delivered']);
      expect(await ordersOf('1-212-555-0142')).toStrictEqual([cancelled, delivered]);
      expect(delivered.statusEvents).toStrictEqual([
        { id: expect.any(Number), fromStatus: null, toStatus: 'placed', changedAt: at(0) },
        { id: expect.any(Number), fromStatus: 'placed', toStatus: 'preparing', changedAt: at(5) },
        { id: expect.any(Number), fromStatus: 'preparing', toStatus: 'ready', changedAt: at(20) },
        { id: expect.any(Number), fromStatus: 'ready', toStatus: 'delivered', changedAt: at(35) },
      ]);
    });

    it('3. staff see every live order, from every phone, in one queue', async () => {
      const menu = await readMenu();
      /** A cheese pizza order, with a note for the card. */
      const cheeseOrder = (customer: Customer, notes: string, quantity = 1): PlaceOrderRequest => ({
        phoneNumber: customer.typed,
        notes,
        items: [line(menu, { pizza: 'Cheese', size: 'Small', crust: 'Hand-Tossed', quantity })],
      });

      // The first orders of the evening, which the kitchen has worked on since.
      const delivered = await placeOrderAt(0, cheeseOrder(ALICE, 'Leave it at the door'));
      const cancelled = await placeOrderAt(1, cheeseOrder(BOB, 'Wrong address'));
      const ready = await placeOrderAt(2, cheeseOrder(CAROL, 'Pick-up', 3));
      const preparing = await placeOrderAt(3, cheeseOrder(ALICE, 'Extra napkins', 2));
      await work(delivered, [4, 'preparing'], [9, 'ready'], [12, 'delivered']);
      await work(cancelled, [5, 'cancelled']);
      const readyNow = await work(ready, [6, 'preparing'], [11, 'ready']);
      const preparingNow = await work(preparing, [10, 'preparing']);

      // Then a rush: Alice, Bob, and Carol order in turn, a minute apart, for
      // seven rounds. With the two orders in the kitchen that makes 23 live
      // orders, more than the 20 a customer lookup returns, so a capped queue
      // would show.
      const rush: OrderDetails[] = [];
      for (let round = 1; round <= 7; round += 1) {
        for (const customer of [ALICE, BOB, CAROL]) {
          const notes = `Rush order ${rush.length + 1}`;
          rush.push(await placeOrderAt(20 + rush.length, cheeseOrder(customer, notes, round)));
        }
      }

      // One list, oldest first, of every live order: status, phone, notes,
      // items, and history. Neither finished order is on it.
      const queue = await staffQueue();
      expect(queue).toStrictEqual([readyNow, preparingNow, ...rush]);
      expect(new Set(queue.map(({ phoneNumber }) => phoneNumber))).toStrictEqual(
        new Set([ALICE.phoneNumber, BOB.phoneNumber, CAROL.phoneNumber]),
      );
      // Each card has what the kitchen needs: whose order it is, the customer's
      // note, and the pizzas.
      expect(queue.map(({ notes }) => notes)).toStrictEqual([
        'Pick-up',
        'Extra napkins',
        ...rush.map((_, index) => `Rush order ${index + 1}`),
      ]);
      expect(queue.slice(0, 3)).toMatchObject([
        {
          status: 'ready',
          phoneNumber: CAROL.phoneNumber,
          items: [
            {
              menuItemName: 'Cheese',
              sizeName: 'Small',
              crustName: 'Hand-Tossed',
              quantity: 3,
              toppings: [],
            },
          ],
        },
        { status: 'preparing', phoneNumber: ALICE.phoneNumber, items: [{ quantity: 2 }] },
        { status: 'placed', phoneNumber: ALICE.phoneNumber, items: [{ quantity: 1 }] },
      ]);

      // It is every customer's live orders together, as each of them tracks them.
      for (const customer of [ALICE, BOB, CAROL]) {
        const tracked = await ordersOf(customer.typed);
        expect(
          queue.filter(({ phoneNumber }) => phoneNumber === customer.phoneNumber),
        ).toStrictEqual(tracked.filter(({ status }) => LIVE.includes(status)).toReversed());
      }
    });

    it('4. staff advance an order one step per click, cancel only from placed or preparing, and get 409 for any other move', async () => {
      const menu = await readMenu();
      const hawaiian: PlaceOrderRequest = {
        phoneNumber: ALICE.typed,
        items: [line(menu, { pizza: 'Hawaiian', size: 'Large', crust: 'Hand-Tossed' })],
      };

      // Each click moves the order one step and records an event for it.
      const order = await placeOrderAt(0, hawaiian);
      const preparing = await work(order, [5, 'preparing']);
      // A second click on the same button changes nothing.
      await expectRefused(6, preparing, 'preparing');
      const ready = await work(preparing, [15, 'ready']);
      const delivered = await work(ready, [20, 'delivered']);
      expect(await staffQueue()).toStrictEqual([]);

      // Cancel works while the order is placed or preparing...
      const cancelledWhilePlaced = await work(await placeOrderAt(25, hawaiian), [26, 'cancelled']);
      const cancelledWhilePreparing = await work(
        await placeOrderAt(30, hawaiian),
        [31, 'preparing'],
        [32, 'cancelled'],
      );
      // ...and is refused once it is ready or delivered.
      const readyToCancel = await work(
        await placeOrderAt(35, hawaiian),
        [36, 'preparing'],
        [37, 'ready'],
      );
      await expectRefused(38, readyToCancel, 'cancelled');
      await expectRefused(38, delivered, 'cancelled');

      // Every move the rule does not allow is refused, from every status.
      const inStatus: Record<OrderStatus, OrderDetails> = {
        placed: await placeOrderAt(40, hawaiian),
        preparing: await work(await placeOrderAt(41, hawaiian), [42, 'preparing']),
        ready: readyToCancel,
        delivered,
        cancelled: cancelledWhilePreparing,
      };
      for (const from of ORDER_STATUSES) {
        for (const to of ORDER_STATUSES) {
          if (!LEGAL_MOVES[from].includes(to)) {
            await expectRefused(50, inStatus[from], to);
          }
        }
      }

      // A refused click changes nothing: every order reads as before.
      expect(await ordersOf(ALICE.typed)).toStrictEqual([
        inStatus.preparing,
        inStatus.placed,
        readyToCancel,
        cancelledWhilePreparing,
        cancelledWhilePlaced,
        delivered,
      ]);
      expect(await staffQueue()).toStrictEqual([
        readyToCancel,
        inStatus.placed,
        inStatus.preparing,
      ]);
    });

    it('5. staff create, edit, and hide a menu item and a topping; hidden ones leave the customer menu and cannot be ordered', async () => {
      // Staff add a pizza and a topping, and customers can pick them at once.
      const truffle = await createMenuItem({
        name: 'Truffle Shuffle',
        description: 'Truffle cream, mushrooms, and fontina.',
        category: 'Specialty',
        basePriceCents: 1799,
      });
      expect(truffle).toStrictEqual({
        id: expect.any(Number),
        name: 'Truffle Shuffle',
        description: 'Truffle cream, mushrooms, and fontina.',
        category: 'Specialty',
        basePriceCents: 1799,
        available: true,
        createdAt: at(0),
      });
      const honey = await createTopping({ name: 'Hot Honey', priceCents: 175 });
      expect(honey).toStrictEqual({
        id: expect.any(Number),
        name: 'Hot Honey',
        priceCents: 175,
        available: true,
      });
      let menu = await readMenu();
      expect(menu.menuItems).toContainEqual(truffle);
      expect(menu.toppings).toContainEqual(honey);

      // A cart line saved now keeps these ids after the rows change.
      const savedLine = line(menu, {
        pizza: 'Truffle Shuffle',
        size: 'Small',
        crust: 'Hand-Tossed',
        toppings: ['Hot Honey'],
      });
      const firstOrder = await placeOrderAt(5, { phoneNumber: BOB.typed, items: [savedLine] });
      // 1799 x 1 + 0 crust + 175 topping.
      expect(firstOrder).toMatchObject({
        totalCents: 1974,
        items: [
          {
            menuItemName: 'Truffle Shuffle',
            unitPriceCents: 1974,
            toppings: [{ toppingName: 'Hot Honey', priceCents: 175 }],
          },
        ],
      });

      // Staff edit both. Customers see the new name, description, category,
      // and price, and new orders pay the new prices.
      const edited = await editMenuItem(truffle.id, {
        name: 'Truffle Supreme',
        description: 'Truffle cream, wild mushrooms, fontina, and thyme.',
        category: 'Seasonal',
        basePriceCents: 1899,
      });
      expect(edited).toStrictEqual({
        ...truffle,
        name: 'Truffle Supreme',
        description: 'Truffle cream, wild mushrooms, fontina, and thyme.',
        category: 'Seasonal',
        basePriceCents: 1899,
      });
      const spicyHoney = await editTopping(honey.id, { name: 'Spicy Honey', priceCents: 200 });
      expect(spicyHoney).toStrictEqual({ ...honey, name: 'Spicy Honey', priceCents: 200 });
      menu = await readMenu();
      expect(menu.menuItems).toContainEqual(edited);
      expect(menu.toppings).toContainEqual(spicyHoney);
      expect(menu.menuItems.map(({ name }) => name)).not.toContain('Truffle Shuffle');
      expect(menu.toppings.map(({ name }) => name)).not.toContain('Hot Honey');
      const secondOrder = await placeOrderAt(10, { phoneNumber: BOB.typed, items: [savedLine] });
      // 1899 x 1 + 0 crust + 200 topping.
      expect(secondOrder.totalCents).toBe(2099);

      // Staff hide both. They leave the customer menu, and staff still see them,
      // marked hidden.
      const hiddenItem = await editMenuItem(truffle.id, { available: false });
      expect(hiddenItem).toStrictEqual({ ...edited, available: false });
      const hiddenTopping = await editTopping(honey.id, { available: false });
      expect(hiddenTopping).toStrictEqual({ ...spicyHoney, available: false });
      menu = await readMenu();
      expect(menu.menuItems.map(({ id }) => id)).not.toContain(truffle.id);
      expect(menu.toppings.map(({ id }) => id)).not.toContain(honey.id);
      expect(await getOk('/api/staff/menu-items')).toContainEqual(hiddenItem);
      expect(await getOk('/api/staff/toppings')).toContainEqual(hiddenTopping);

      // A cart that still holds them cannot be checked out: 422, and no order
      // is stored.
      const hiddenPizzaOrder = await postOrder(15, {
        phoneNumber: BOB.typed,
        items: [{ ...savedLine, toppingIds: [] }],
      });
      expect(hiddenPizzaOrder.status).toBe(422);
      expect(hiddenPizzaOrder.body).toStrictEqual({
        error: {
          code: 'ITEM_UNAVAILABLE',
          message: 'Some of the items in this order are not available',
          details: {
            issues: [
              { path: 'items.0.menuItemId', message: `Menu item ${truffle.id} is not available` },
            ],
          },
        },
      });
      const hiddenToppingOrder = await postOrder(15, {
        phoneNumber: BOB.typed,
        items: [
          {
            ...line(menu, { pizza: 'Cheese', size: 'Small', crust: 'Hand-Tossed' }),
            toppingIds: [honey.id],
          },
        ],
      });
      expect(hiddenToppingOrder.status).toBe(422);
      expect(hiddenToppingOrder.body).toStrictEqual({
        error: {
          code: 'ITEM_UNAVAILABLE',
          message: 'Some of the items in this order are not available',
          details: {
            issues: [
              { path: 'items.0.toppingIds.0', message: `Topping ${honey.id} is not available` },
            ],
          },
        },
      });

      // The orders placed before keep their lines and prices. Names are not
      // snapshotted, so the lines show the current ones (ADR 0003,
      // Consequences). The refused checkouts stored nothing.
      const withEditedNames = (order: OrderDetails): OrderDetails => ({
        ...order,
        items: order.items.map((item) => ({
          ...item,
          menuItemName: 'Truffle Supreme',
          toppings: item.toppings.map((topping) => ({ ...topping, toppingName: 'Spicy Honey' })),
        })),
      });
      expect(await staffQueue()).toStrictEqual([firstOrder, secondOrder].map(withEditedNames));
      expect(await ordersOf(BOB.typed)).toStrictEqual(
        [secondOrder, firstOrder].map(withEditedNames),
      );

      // Hiding is not deleting: shown again, both are back on sale.
      await editMenuItem(truffle.id, { available: true });
      await editTopping(honey.id, { available: true });
      menu = await readMenu();
      expect(menu.menuItems).toContainEqual(edited);
      expect(menu.toppings).toContainEqual(spicyHoney);
      expect(await placeOrderAt(20, { phoneNumber: BOB.typed, items: [savedLine] })).toMatchObject({
        totalCents: 2099,
      });
    });

    it('6. order totals keep their snapshotted prices after staff change menu item and topping prices', async () => {
      const menu = await readMenu();
      const items = [
        line(menu, {
          pizza: 'Hawaiian',
          size: 'Large',
          crust: 'Hand-Tossed',
          toppings: ['Pepperoni', 'Extra Cheese'],
          quantity: 2,
        }),
        line(menu, { pizza: 'Cheese', size: 'Small', crust: 'Gluten-Free' }),
      ];
      const order = await placeOrderAt(0, { phoneNumber: CAROL.typed, items });
      // round(1399 x 1.5 = 2098.5) = 2099, + 0 crust, + 200 + 150 toppings, twice;
      // then 999 x 1 + 300 crust.
      expect(order).toMatchObject({
        totalCents: 2 * 2449 + 1299,
        items: [
          {
            unitPriceCents: 2449,
            quantity: 2,
            toppings: [{ priceCents: 200 }, { priceCents: 150 }],
          },
          { unitPriceCents: 1299, quantity: 1, toppings: [] },
        ],
      });

      // Staff raise the price of both pizzas and both toppings.
      await editMenuItem(named(menu.menuItems, 'Hawaiian').id, { basePriceCents: 1599 });
      await editMenuItem(named(menu.menuItems, 'Cheese').id, { basePriceCents: 1099 });
      await editTopping(named(menu.toppings, 'Pepperoni').id, { priceCents: 275 });
      await editTopping(named(menu.toppings, 'Extra Cheese').id, { priceCents: 175 });

      // The same order placed now pays the new prices.
      const repeat = await placeOrderAt(10, { phoneNumber: CAROL.typed, items });
      // round(1599 x 1.5 = 2398.5) = 2399, + 0 crust, + 275 + 175 toppings, twice;
      // then 1099 x 1 + 300 crust.
      expect(repeat).toMatchObject({
        totalCents: 2 * 2849 + 1399,
        items: [
          {
            unitPriceCents: 2849,
            quantity: 2,
            toppings: [{ priceCents: 275 }, { priceCents: 175 }],
          },
          { unitPriceCents: 1399, quantity: 1, toppings: [] },
        ],
      });

      // The first order keeps the prices it was placed with: in the staff queue,
      // in the customer's lookup, and through every status change. Hiding a
      // topping it used does not change it either.
      expect(await staffQueue()).toStrictEqual([order, repeat]);
      expect(await ordersOf(CAROL.typed)).toStrictEqual([repeat, order]);
      const delivered = await work(order, [15, 'preparing'], [25, 'ready'], [30, 'delivered']);
      await editTopping(named(menu.toppings, 'Extra Cheese').id, { available: false });
      expect(await ordersOf(CAROL.typed)).toStrictEqual([repeat, delivered]);

      // Each total is the sum of its snapshotted lines.
      for (const { totalCents, items: lines } of await ordersOf(CAROL.typed)) {
        expect(totalCents).toBe(
          lines.reduce((sum, { unitPriceCents, quantity }) => sum + unitPriceCents * quantity, 0),
        );
      }
    });
  });

  describe('security review standards (docs/PROJECT_MANIFEST.md)', () => {
    it("customer endpoints never return another phone's orders", async () => {
      const menu = await readMenu();
      const items = [line(menu, { pizza: 'Margherita', size: 'Medium', crust: 'Hand-Tossed' })];
      const alicesFirst = await placeOrderAt(0, { phoneNumber: ALICE.typed, items });
      const bobs = await placeOrderAt(1, {
        phoneNumber: BOB.typed,
        notes: 'Call when outside',
        items,
      });
      const alicesSecond = await placeOrderAt(2, {
        phoneNumber: ALICE.typed,
        notes: 'Side door',
        items,
      });
      const bobsNow = await work(bobs, [3, 'preparing']);

      // Each customer gets their own orders and nothing else, and a number with
      // no orders gets none.
      expect(await ordersOf(ALICE.typed)).toStrictEqual([alicesSecond, alicesFirst]);
      expect(await ordersOf(BOB.typed)).toStrictEqual([bobsNow]);
      expect(await ordersOf(CAROL.typed)).toStrictEqual([]);
      const alicesView = await lookUp({ phone: ALICE.typed });
      expect(alicesView.text).not.toContain('3125550173');
      expect(alicesView.text).not.toContain('Call when outside');

      // A lookup without a usable number is refused, never answered with
      // everyone's orders, and the error does not repeat what was sent.
      const unusable: Record<string, string>[] = [
        {},
        { phone: '' },
        { phone: '555-0173' },
        { phone: '*' },
        { phone: "' OR '1'='1" },
      ];
      for (const query of unusable) {
        const res = await lookUp(query);
        expect(res.status, JSON.stringify(query)).toBe(400);
        expect(res.body).toStrictEqual(INVALID_PHONE_NUMBER);
      }
      // Two numbers at once are refused rather than merged.
      const both = await lookUp('phone=2125550142&phone=3125550173');
      expect(both.status).toBe(400);
      expect(both.body).toMatchObject({
        error: { code: 'VALIDATION_ERROR', details: { issues: [{ path: 'phone' }] } },
      });
      // Parameters the lookup does not take change nothing.
      const widened = await lookUp({
        phone: ALICE.typed,
        phoneNumber: BOB.typed,
        statuses: 'placed,preparing,ready',
        limit: '100',
        sort: 'oldest',
      });
      expect(widened.status).toBe(200);
      expect(widened.body).toStrictEqual([alicesSecond, alicesFirst]);

      // No customer route reads one order by its id.
      const byId = await request(app).get(`/api/orders/${bobs.id}`).query({ phone: ALICE.typed });
      expect(byId.status).toBe(404);
      expect(byId.body).toStrictEqual({
        error: { code: 'NOT_FOUND', message: `No route for GET /api/orders/${bobs.id}` },
      });
    });

    it('the server ignores prices the client sends', async () => {
      const menu = await readMenu();
      const items = [
        line(menu, {
          pizza: 'Meat Lovers',
          size: 'Large',
          crust: 'Stuffed Crust',
          toppings: ['Bacon'],
          quantity: 3,
        }),
      ];
      const bacon = named(menu.toppings, 'Bacon');

      // A tampered checkout: a one-cent total, free pizzas and toppings, and
      // fields only the server sets.
      const tampered = await postOrder(0, {
        phoneNumber: ALICE.typed,
        id: 999,
        status: 'delivered',
        totalCents: 1,
        createdAt: '2000-01-01T00:00:00.000Z',
        items: items.map((item) => ({
          ...item,
          unitPriceCents: 1,
          lineTotalCents: 1,
          basePriceCents: 0,
          toppings: [{ toppingId: bacon.id, priceCents: 0 }],
        })),
      });

      // What the server charges: round(1599 x 1.5 = 2398.5) = 2399, + 200
      // crust, + 200 topping, three times.
      const serverPrices = {
        totalCents: 3 * 2799,
        items: [
          {
            unitPriceCents: 2799,
            quantity: 3,
            toppings: [{ toppingId: bacon.id, toppingName: 'Bacon', priceCents: 200 }],
          },
        ],
      };
      expect(tampered.status, tampered.text).toBe(201);
      expect(tampered.body).toMatchObject({
        ...serverPrices,
        status: 'placed',
        createdAt: at(0),
        statusEvents: [{ fromStatus: null, toStatus: 'placed', changedAt: at(0) }],
      });
      expect(tampered.body.id).not.toBe(999);

      // It costs what the honest checkout costs, and it is stored that way.
      const honest = await placeOrderAt(1, { phoneNumber: ALICE.typed, items });
      expect(honest).toMatchObject(serverPrices);
      expect(await ordersOf(ALICE.typed)).toStrictEqual([honest, tampered.body]);
      expect(await staffQueue()).toStrictEqual([tampered.body, honest]);
    });
  });
});
