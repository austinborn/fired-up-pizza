import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import {
  MAX_ITEMS_PER_ORDER,
  MAX_ORDER_NOTES_LENGTH,
  type OrderDetails,
  type PlaceOrderItem,
  type PlaceOrderRequest,
} from '@fired-up-pizza/shared/orders-api';
import { computeOrderTotalCents, computeUnitPriceCents } from '@fired-up-pizza/shared/pricing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { Db } from '../db/connection';
import { createCatalogRepository, type CatalogRepository } from '../repositories/catalog';
import { getOrderDetails, listOrderDetails } from '../repositories/orders';
import { recordInitialStatus } from '../services/order-status';
import { placeOrder } from '../services/orders';
import { createTestDatabase } from '../test/database';

// The whole app runs against an in-memory database with the starter catalog
// (CATALOG_SEED in server/src/db/seed.ts). Two services are wrapped but still
// run for real: placeOrder, so a test can see what the route passes it, and
// recordInitialStatus, so a test can make the place-order transaction fail after
// the order rows are written. vi.resetAllMocks() restores the real behavior
// after each test.
vi.mock(import('../services/order-status'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordInitialStatus: vi.fn(actual.recordInitialStatus) };
});
vi.mock(import('../services/orders'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, placeOrder: vi.fn(actual.placeOrder) };
});

const PHONE = '+12125550142';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UNKNOWN_ID = 9999;

/** The starter catalog row with this name. */
function named<Row extends { name: string }>(rows: readonly Row[], name: string): Row {
  const row = rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(`The starter catalog has no row named ${name}`);
  }
  return row;
}

/** `body` with `changes` applied to its item at `index`. */
function withItem(body: PlaceOrderRequest, index: number, changes: Record<string, unknown>) {
  return {
    ...body,
    items: body.items.map((item, position) =>
      position === index ? { ...item, ...changes } : item,
    ),
  };
}

/** Bodies that do not fit PlaceOrderRequest, and the path of the issue each must report. */
const MALFORMED_BODIES: {
  name: string;
  path: string;
  malform: (body: PlaceOrderRequest) => unknown;
}[] = [
  { name: 'no phone number', path: 'phoneNumber', malform: ({ phoneNumber: _, ...body }) => body },
  {
    name: 'a phone number that is not a string',
    path: 'phoneNumber',
    malform: (body) => ({ ...body, phoneNumber: 2125550142 }),
  },
  {
    name: 'notes that are not a string',
    path: 'notes',
    malform: (body) => ({ ...body, notes: 42 }),
  },
  { name: 'null notes', path: 'notes', malform: (body) => ({ ...body, notes: null }) },
  { name: 'no items', path: 'items', malform: ({ items: _, ...body }) => body },
  {
    name: 'items that are not a list',
    path: 'items',
    malform: (body) => ({ ...body, items: 'pizza' }),
  },
  {
    name: 'an item that is not an object',
    path: 'items.1',
    malform: (body) => ({ ...body, items: [body.items[0], 42] }),
  },
  {
    name: 'a menu item id that is a string',
    path: 'items.0.menuItemId',
    malform: (body) => withItem(body, 0, { menuItemId: '1' }),
  },
  {
    name: 'a fractional menu item id',
    path: 'items.0.menuItemId',
    malform: (body) => withItem(body, 0, { menuItemId: 1.5 }),
  },
  {
    name: 'a menu item id beyond the safe integers',
    path: 'items.0.menuItemId',
    malform: (body) => withItem(body, 0, { menuItemId: 2 ** 53 }),
  },
  {
    name: 'a size id of 0',
    path: 'items.0.sizeId',
    malform: (body) => withItem(body, 0, { sizeId: 0 }),
  },
  {
    name: 'a negative crust id',
    path: 'items.1.crustId',
    malform: (body) => withItem(body, 1, { crustId: -1 }),
  },
  {
    name: 'no topping list',
    path: 'items.0.toppingIds',
    malform: (body) => withItem(body, 0, { toppingIds: undefined }),
  },
  {
    name: 'a topping id that is not a number',
    path: 'items.0.toppingIds.1',
    malform: (body) => withItem(body, 0, { toppingIds: [1, 'x'] }),
  },
  {
    name: 'a quantity that is a string',
    path: 'items.0.quantity',
    malform: (body) => withItem(body, 0, { quantity: '2' }),
  },
  {
    name: 'no quantity',
    path: 'items.0.quantity',
    malform: (body) => withItem(body, 0, { quantity: undefined }),
  },
  { name: 'a body that is a list', path: '', malform: (body) => [body] },
];

describe('POST /api/orders', () => {
  let db: Db;
  let catalog: CatalogRepository;
  let margherita: MenuItem;
  let hawaiian: MenuItem;
  let medium: Size;
  let large: Size;
  let handTossed: Crust;
  let stuffedCrust: Crust;
  let pepperoni: Topping;
  let mushrooms: Topping;

  beforeEach(() => {
    db = createTestDatabase({ seed: true });
    catalog = createCatalogRepository(db);
    margherita = named(catalog.listMenuItems(), 'Margherita');
    hawaiian = named(catalog.listMenuItems(), 'Hawaiian');
    medium = named(catalog.listSizes(), 'Medium');
    large = named(catalog.listSizes(), 'Large');
    handTossed = named(catalog.listCrusts(), 'Hand-Tossed');
    stuffedCrust = named(catalog.listCrusts(), 'Stuffed Crust');
    pepperoni = named(catalog.listToppings(), 'Pepperoni');
    mushrooms = named(catalog.listToppings(), 'Mushrooms');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    db.close();
  });

  /** Two medium Margheritas with stuffed crust, pepperoni, and mushrooms. */
  function margheritas(overrides: Partial<PlaceOrderItem> = {}): PlaceOrderItem {
    return {
      menuItemId: margherita.id,
      sizeId: medium.id,
      crustId: stuffedCrust.id,
      toppingIds: [pepperoni.id, mushrooms.id],
      quantity: 2,
      ...overrides,
    };
  }

  /** One large hand-tossed Hawaiian with no extra toppings. */
  function hawaiianLine(): PlaceOrderItem {
    return {
      menuItemId: hawaiian.id,
      sizeId: large.id,
      crustId: handTossed.id,
      toppingIds: [],
      quantity: 1,
    };
  }

  function validBody(overrides: Partial<PlaceOrderRequest> = {}): PlaceOrderRequest {
    return {
      phoneNumber: '(212) 555-0142',
      notes: 'Ring twice',
      items: [margheritas(), hawaiianLine()],
      ...overrides,
    };
  }

  function post(body: unknown) {
    return request(createApp({ db }))
      .post('/api/orders')
      .send(body as object);
  }

  /** Every stored order. Foreign keys tie each line, topping, and status event to an order. */
  function storedOrders(): OrderDetails[] {
    return listOrderDetails(db, { limit: 100, sort: 'oldest' });
  }

  /** The unit prices of margheritas() and hawaiianLine(), from the shared formula (ADR 0003 rule 2). */
  function expectedUnitPrices() {
    return {
      margheritaCents: computeUnitPriceCents({
        basePriceCents: margherita.basePriceCents,
        sizeMultiplier: medium.priceMultiplier,
        crustDeltaCents: stuffedCrust.priceDeltaCents,
        toppingPricesCents: [pepperoni.priceCents, mushrooms.priceCents],
      }),
      hawaiianCents: computeUnitPriceCents({
        basePriceCents: hawaiian.basePriceCents,
        sizeMultiplier: large.priceMultiplier,
        crustDeltaCents: handTossed.priceDeltaCents,
        toppingPricesCents: [],
      }),
    };
  }

  describe('placing an order', () => {
    it('returns 201 with the order as stored, priced by the shared formula', async () => {
      const { margheritaCents, hawaiianCents } = expectedUnitPrices();

      const res = await post(validBody());

      expect(res.status).toBe(201);
      expect(res.type).toBe('application/json');
      expect(res.body).toStrictEqual({
        id: expect.any(Number),
        phoneNumber: PHONE,
        status: 'placed',
        totalCents: computeOrderTotalCents([
          { unitPriceCents: margheritaCents, quantity: 2 },
          { unitPriceCents: hawaiianCents, quantity: 1 },
        ]),
        notes: 'Ring twice',
        createdAt: expect.stringMatching(ISO_UTC),
        updatedAt: res.body.createdAt,
        items: [
          {
            id: expect.any(Number),
            menuItemId: margherita.id,
            menuItemName: 'Margherita',
            sizeId: medium.id,
            sizeName: 'Medium',
            crustId: stuffedCrust.id,
            crustName: 'Stuffed Crust',
            quantity: 2,
            unitPriceCents: margheritaCents,
            toppings: [
              { toppingId: pepperoni.id, toppingName: 'Pepperoni', priceCents: 200 },
              { toppingId: mushrooms.id, toppingName: 'Mushrooms', priceCents: 150 },
            ],
          },
          {
            id: expect.any(Number),
            menuItemId: hawaiian.id,
            menuItemName: 'Hawaiian',
            sizeId: large.id,
            sizeName: 'Large',
            crustId: handTossed.id,
            crustName: 'Hand-Tossed',
            quantity: 1,
            unitPriceCents: hawaiianCents,
            toppings: [],
          },
        ],
        statusEvents: [
          {
            id: expect.any(Number),
            fromStatus: null,
            toStatus: 'placed',
            changedAt: res.body.createdAt,
          },
        ],
      });
      // 1099 * 1.25 = 1373.75, charged as 1374, + 200 + 200 + 150; 1399 * 1.5 = 2098.5, charged as 2099.
      expect(res.body.totalCents).toBe(2 * 1924 + 2099);
      expect(storedOrders()).toStrictEqual([res.body]);
    });

    it('returns snapshot prices that later menu changes do not alter (ADR 0003 rule 4)', async () => {
      const res = await post(validBody());

      expect(catalog.updateMenuItem(margherita.id, { basePriceCents: 1599 }).ok).toBe(true);
      expect(catalog.updateTopping(mushrooms.id, { priceCents: 300, available: false }).ok).toBe(
        true,
      );

      expect(getOrderDetails(db, res.body.id)).toStrictEqual(res.body);
    });

    it.each(['(212) 555-0142', '212.555.0142', '1 212 555 0142', '+1 212-555-0142'])(
      'stores the phone number %j as the identity module normalizes it (ADR 0005)',
      async (phoneNumber) => {
        const res = await post(validBody({ phoneNumber }));

        expect(res.status).toBe(201);
        expect(res.body.phoneNumber).toBe(PHONE);
      },
    );

    it('ignores prices, a status, and any other fields the client adds (ADR 0003 rule 3)', async () => {
      const { margheritaCents, hawaiianCents } = expectedUnitPrices();

      const res = await post({
        ...validBody(),
        id: 999,
        status: 'delivered',
        totalCents: 1,
        createdAt: '2000-01-01T00:00:00.000Z',
        statusEvents: [],
        items: validBody().items.map((item) => ({
          ...item,
          unitPriceCents: 1,
          priceCents: 1,
          lineTotalCents: 1,
          toppings: [{ toppingId: pepperoni.id, priceCents: 0 }],
        })),
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'placed',
        totalCents: 2 * margheritaCents + hawaiianCents,
        items: [
          {
            unitPriceCents: margheritaCents,
            toppings: [{ priceCents: 200 }, { priceCents: 150 }],
          },
          { unitPriceCents: hawaiianCents, toppings: [] },
        ],
        statusEvents: [{ fromStatus: null, toStatus: 'placed' }],
      });
      expect(res.body.id).not.toBe(999);
      expect(res.body.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
      expect(storedOrders()).toStrictEqual([res.body]);
      // Validation strips the extra fields, so the service never sees them.
      expect(placeOrder).toHaveBeenCalledExactlyOnceWith(db, {
        customer: { phoneNumber: PHONE },
        notes: 'Ring twice',
        items: [margheritas(), hawaiianLine()],
      });
    });

    it('trims the notes and stores empty notes when there are none', async () => {
      const trimmed = await post(validBody({ notes: '  Extra napkins, please \n' }));
      const { notes: _, ...withoutNotes } = validBody();
      const omitted = await post(withoutNotes);

      expect(trimmed.body.notes).toBe('Extra napkins, please');
      expect(omitted.status).toBe(201);
      expect(omitted.body.notes).toBe('');
    });

    it('accepts notes of MAX_ORDER_NOTES_LENGTH characters once trimmed', async () => {
      const notes = 'n'.repeat(MAX_ORDER_NOTES_LENGTH);

      const res = await post(validBody({ notes: `  ${notes}  ` }));

      expect(res.status).toBe(201);
      expect(res.body.notes).toBe(notes);
    });

    it('accepts MAX_ITEMS_PER_ORDER items', async () => {
      const items = Array.from({ length: MAX_ITEMS_PER_ORDER }, () => hawaiianLine());

      const res = await post(validBody({ items }));

      expect(res.status).toBe(201);
      expect(res.body.items).toHaveLength(MAX_ITEMS_PER_ORDER);
    });

    it('never logs the phone number (ADR 0005 rule 5)', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );

      await post(validBody());
      await post(validBody({ phoneNumber: '212-555-014' }));

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });

  describe('rejecting an order', () => {
    it.each(MALFORMED_BODIES)(
      'answers $name with 400 VALIDATION_ERROR and stores nothing',
      async ({ path, malform }) => {
        const res = await post(malform(validBody()));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
        });
        expect(res.body.error.details.issues).toContainEqual({ path, message: expect.any(String) });
        expect(storedOrders()).toEqual([]);
      },
    );

    it.each([
      { name: 'no items', items: [], message: 'An order needs at least one item' },
      {
        name: 'more than MAX_ITEMS_PER_ORDER items',
        items: Array.from({ length: MAX_ITEMS_PER_ORDER + 1 }, () => ({
          menuItemId: 1,
          sizeId: 1,
          crustId: 1,
          toppingIds: [],
          quantity: 1,
        })),
        message: `An order can have at most ${MAX_ITEMS_PER_ORDER} items`,
      },
    ])('answers $name with 400 VALIDATION_ERROR and stores nothing', async ({ items, message }) => {
      const res = await post(validBody({ items }));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.issues).toEqual([{ path: 'items', message }]);
      expect(storedOrders()).toEqual([]);
    });

    it('answers notes longer than MAX_ORDER_NOTES_LENGTH with 400 VALIDATION_ERROR', async () => {
      const res = await post(validBody({ notes: 'n'.repeat(MAX_ORDER_NOTES_LENGTH + 1) }));

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.issues).toEqual([
        { path: 'notes', message: `Notes must be at most ${MAX_ORDER_NOTES_LENGTH} characters` },
      ]);
      expect(storedOrders()).toEqual([]);
    });

    it('names the id rule when an id is not a positive whole number', async () => {
      const res = await post(withItem(validBody(), 0, { toppingIds: [pepperoni.id, 0] }));

      expect(res.body.error.details.issues).toEqual([
        { path: 'items.0.toppingIds.1', message: 'Id must be a positive whole number' },
      ]);
    });

    it.each(['212-555-014', '+44 20 7946 0958', '555-123-4567', ''])(
      'answers the phone number %j with 400 INVALID_PHONE_NUMBER, without repeating it',
      async (phoneNumber) => {
        const res = await post(validBody({ phoneNumber }));

        expect(res.status).toBe(400);
        expect(res.body).toEqual({
          error: { code: 'INVALID_PHONE_NUMBER', message: expect.any(String) },
        });
        expect(res.body.error.message).not.toMatch(/\d{3}/);
        expect(storedOrders()).toEqual([]);
      },
    );

    it.each([
      {
        name: 'a quantity of 0',
        change: { quantity: 0 },
        issue: {
          path: 'items.0.quantity',
          message: 'Quantity must be a whole number from 1 to 20',
        },
      },
      {
        name: 'a quantity above the limit',
        change: { quantity: 21 },
        issue: {
          path: 'items.0.quantity',
          message: 'Quantity must be a whole number from 1 to 20',
        },
      },
      {
        name: 'a fractional quantity',
        change: { quantity: 1.5 },
        issue: {
          path: 'items.0.quantity',
          message: 'Quantity must be a whole number from 1 to 20',
        },
      },
      {
        name: 'a topping listed twice',
        change: { toppingIds: [7, 7] },
        issue: { path: 'items.0.toppingIds', message: 'Each topping can be added only once' },
      },
      {
        name: 'more toppings than the limit',
        change: { toppingIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
        issue: { path: 'items.0.toppingIds', message: 'A pizza can have at most 10 toppings' },
      },
    ])(
      'answers $name with the pricing service 400 VALIDATION_ERROR and stores nothing',
      async ({ change, issue }) => {
        const res = await post(withItem(validBody(), 0, change));

        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: { issues: [issue] },
        });
        expect(storedOrders()).toEqual([]);
      },
    );

    it('answers a hidden menu item with 422 ITEM_UNAVAILABLE and stores nothing', async () => {
      expect(catalog.updateMenuItem(margherita.id, { available: false }).ok).toBe(true);

      const res = await post(validBody());

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: 'ITEM_UNAVAILABLE',
        message: 'Some of the items in this order are not available',
        details: {
          issues: [
            { path: 'items.0.menuItemId', message: `Menu item ${margherita.id} is not available` },
          ],
        },
      });
      expect(storedOrders()).toEqual([]);
    });

    it('answers a hidden topping with 422 ITEM_UNAVAILABLE and stores nothing', async () => {
      expect(catalog.updateTopping(mushrooms.id, { available: false }).ok).toBe(true);

      const res = await post(validBody());

      expect(res.status).toBe(422);
      expect(res.body.error.details.issues).toEqual([
        { path: 'items.0.toppingIds.1', message: `Topping ${mushrooms.id} is not available` },
      ]);
      expect(storedOrders()).toEqual([]);
    });

    it('answers unknown catalog ids with 422 ITEM_UNAVAILABLE listing each of them', async () => {
      const res = await post(
        validBody({
          items: [
            margheritas({ menuItemId: UNKNOWN_ID, toppingIds: [UNKNOWN_ID] }),
            { ...hawaiianLine(), sizeId: UNKNOWN_ID, crustId: UNKNOWN_ID },
          ],
        }),
      );

      expect(res.status).toBe(422);
      expect(res.body.error.details.issues).toEqual([
        { path: 'items.0.menuItemId', message: `Menu item ${UNKNOWN_ID} is not available` },
        { path: 'items.0.toppingIds.0', message: `Topping ${UNKNOWN_ID} is not available` },
        { path: 'items.1.sizeId', message: `Size ${UNKNOWN_ID} is not available` },
        { path: 'items.1.crustId', message: `Crust ${UNKNOWN_ID} is not available` },
      ]);
      expect(storedOrders()).toEqual([]);
    });

    it('checks the body shape before the phone number, and the phone number before the catalog', async () => {
      const malformed = await post(validBody({ phoneNumber: 'not a phone', items: [] }));
      const badPhone = await post(
        validBody({ phoneNumber: 'not a phone', items: [margheritas({ menuItemId: UNKNOWN_ID })] }),
      );

      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
      expect(badPhone.body.error.code).toBe('INVALID_PHONE_NUMBER');
    });

    it('answers 500 and stores nothing when a write fails partway through the order', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.mocked(recordInitialStatus).mockImplementationOnce(() => {
        throw new Error('disk I/O error');
      });

      const res = await post(validBody());

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
      });
      expect(recordInitialStatus).toHaveBeenCalledOnce();
      expect(storedOrders()).toEqual([]);
    });
  });
});
