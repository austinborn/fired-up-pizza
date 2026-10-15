import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection';
import { recordInitialStatus, transitionOrderStatus } from '../services/order-status';
import { createTestDatabase } from '../test/database';
import {
  createCatalogRepository,
  type CatalogRepository,
  type CatalogWriteResult,
} from './catalog';
import {
  getOrderDetails,
  insertOrder,
  listOrderDetails,
  type NewOrder,
  type NewOrderItem,
  type OrderDetailsQuery,
  type OrderSort,
} from './orders';

// Orders are built from the starter catalog (CATALOG_SEED in
// server/src/db/seed.ts), found by name. The repository stores whatever prices
// it is given; these follow the ADR 0003 formula so the fixtures stay realistic.

const PHONE = '+12125550142';
const OTHER_PHONE = '+13125550143';
const PLACED_AT = '2026-10-14T23:20:00.000Z';

/** The row with this name. */
function named<Row extends { name: string }>(rows: readonly Row[], name: string): Row {
  const row = rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(`The starter catalog has no row named ${name}`);
  }
  return row;
}

/** The written row of a catalog write that must succeed. */
function written<T>(result: CatalogWriteResult<T>): T {
  if (!result.ok) {
    throw new Error(`Catalog write failed: ${result.failure}`);
  }
  return result.value;
}

/** Places an order as the place-order service does: the rows and the initial event in one transaction. */
function place(db: Db, order: NewOrder): number {
  return db.transaction(() => {
    const orderId = insertOrder(db, order);
    recordInitialStatus(db, orderId);
    return orderId;
  })();
}

/** Returns what `run` throws, or undefined. */
function errorFrom(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('orders repository', () => {
  let db: Db;
  let catalog: CatalogRepository;
  let cheese: MenuItem;
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
    cheese = named(catalog.listMenuItems(), 'Cheese');
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
    db.close();
  });

  /** One medium hand-tossed pizza of `menuItem` with `toppings`, at its current catalog prices. */
  function line(menuItem: MenuItem, toppings: readonly Topping[], quantity = 1): NewOrderItem {
    const toppingsCents = toppings.reduce((sum, topping) => sum + topping.priceCents, 0);
    return {
      menuItemId: menuItem.id,
      sizeId: medium.id,
      crustId: handTossed.id,
      quantity,
      unitPriceCents: Math.round(menuItem.basePriceCents * medium.priceMultiplier) + toppingsCents,
      toppings: toppings.map(({ id, priceCents }) => ({ toppingId: id, priceCents })),
    };
  }

  /**
   * Two medium Margheritas with stuffed crust, pepperoni, and mushrooms at 1924
   * cents each (1099 * 1.25 = 1373.75, charged as 1374, + 200 + 200 + 150), and
   * one large hand-tossed Hawaiian at 2099 (1399 * 1.5 = 2098.5, charged as 2099).
   */
  function sampleOrder(overrides: Partial<NewOrder> = {}): NewOrder {
    return {
      phoneNumber: PHONE,
      totalCents: 2 * 1924 + 2099,
      notes: 'Ring twice',
      createdAt: PLACED_AT,
      items: [
        {
          menuItemId: margherita.id,
          sizeId: medium.id,
          crustId: stuffedCrust.id,
          quantity: 2,
          unitPriceCents: 1924,
          toppings: [
            { toppingId: pepperoni.id, priceCents: 200 },
            { toppingId: mushrooms.id, priceCents: 150 },
          ],
        },
        {
          menuItemId: hawaiian.id,
          sizeId: large.id,
          crustId: handTossed.id,
          quantity: 1,
          unitPriceCents: 2099,
          toppings: [],
        },
      ],
      ...overrides,
    };
  }

  describe('insertOrder and getOrderDetails', () => {
    it('stores a placed order with its lines and toppings and reads it back as OrderDetails', () => {
      const orderId = place(db, sampleOrder());

      const details = getOrderDetails(db, orderId);

      expect(details).toStrictEqual({
        id: orderId,
        phoneNumber: PHONE,
        status: 'placed',
        totalCents: 5947,
        notes: 'Ring twice',
        createdAt: PLACED_AT,
        updatedAt: PLACED_AT,
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
            unitPriceCents: 1924,
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
            unitPriceCents: 2099,
            toppings: [],
          },
        ],
        statusEvents: [
          { id: expect.any(Number), fromStatus: null, toStatus: 'placed', changedAt: PLACED_AT },
        ],
      });
      expect(new Set(details?.items.map(({ id }) => id)).size).toBe(2);
    });

    it('lists lines in the order they were placed and toppings in the order they were chosen', () => {
      // By id, Pepperoni comes before Mushrooms; by name, after. The two
      // Hawaiian and Margherita lines list them both ways, so sorting toppings
      // by either breaks one line. The lines themselves are in neither id nor
      // name order.
      const orderId = place(
        db,
        sampleOrder({
          items: [
            line(hawaiian, [mushrooms, pepperoni]),
            line(margherita, [pepperoni, mushrooms]),
            line(cheese, []),
          ],
        }),
      );

      const items = getOrderDetails(db, orderId)?.items.map(({ menuItemName, toppings }) => [
        menuItemName,
        toppings.map(({ toppingName }) => toppingName),
      ]);

      expect(items).toEqual([
        ['Hawaiian', ['Mushrooms', 'Pepperoni']],
        ['Margherita', ['Pepperoni', 'Mushrooms']],
        ['Cheese', []],
      ]);
    });

    it('returns every price exactly as stored, never a current catalog price', () => {
      const orderId = place(
        db,
        sampleOrder({
          totalCents: 3,
          items: [
            {
              ...line(margherita, [pepperoni]),
              unitPriceCents: 1,
              toppings: [{ toppingId: pepperoni.id, priceCents: 2 }],
            },
          ],
        }),
      );

      expect(getOrderDetails(db, orderId)).toMatchObject({
        totalCents: 3,
        items: [{ unitPriceCents: 1, toppings: [{ priceCents: 2 }] }],
      });
    });

    it('keeps the stored prices and total when staff later reprice or hide what the order references (ADR 0003 rule 4)', () => {
      const orderId = place(db, sampleOrder());
      const before = getOrderDetails(db, orderId);

      written(catalog.updateMenuItem(margherita.id, { basePriceCents: 1599, available: false }));
      written(catalog.updateMenuItem(hawaiian.id, { basePriceCents: 1799 }));
      written(catalog.updateTopping(pepperoni.id, { priceCents: 350, available: false }));
      written(catalog.updateTopping(mushrooms.id, { priceCents: 250 }));

      expect(getOrderDetails(db, orderId)).toStrictEqual(before);
      expect(before).toMatchObject({
        totalCents: 5947,
        items: [
          { unitPriceCents: 1924, toppings: [{ priceCents: 200 }, { priceCents: 150 }] },
          { unitPriceCents: 2099 },
        ],
      });
    });

    it('shows the current names of what the order references, which are not snapshotted (ADR 0003)', () => {
      const orderId = place(db, sampleOrder());

      written(catalog.updateMenuItem(margherita.id, { name: 'Margherita Classica' }));
      written(catalog.updateTopping(mushrooms.id, { name: 'Cremini Mushrooms' }));

      expect(getOrderDetails(db, orderId)?.items[0]).toMatchObject({
        menuItemName: 'Margherita Classica',
        unitPriceCents: 1924,
        toppings: [
          { toppingName: 'Pepperoni', priceCents: 200 },
          { toppingName: 'Cremini Mushrooms', priceCents: 150 },
        ],
      });
    });

    it('keeps each order apart from the others', () => {
      const firstId = place(db, sampleOrder());
      const secondId = place(
        db,
        sampleOrder({ phoneNumber: OTHER_PHONE, items: [line(cheese, [mushrooms], 3)] }),
      );

      expect(getOrderDetails(db, firstId)?.items.map(({ menuItemName }) => menuItemName)).toEqual([
        'Margherita',
        'Hawaiian',
      ]);
      expect(getOrderDetails(db, secondId)).toMatchObject({
        phoneNumber: OTHER_PHONE,
        items: [{ menuItemName: 'Cheese', quantity: 3, toppings: [{ toppingName: 'Mushrooms' }] }],
        statusEvents: [{ fromStatus: null, toStatus: 'placed' }],
      });
    });

    it('returns undefined for an unknown order', () => {
      expect(getOrderDetails(db, 999)).toBeUndefined();
    });

    it('refuses to insert outside a transaction, and writes nothing', () => {
      const error = errorFrom(() => insertOrder(db, sampleOrder()));

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('outside a transaction');
      expect(listOrderDetails(db, { limit: 10, sort: 'oldest' })).toEqual([]);
    });
  });

  describe('listOrderDetails', () => {
    // Five orders from two customers, each with its own line. The third and
    // fourth were created in the same millisecond, so the id breaks their tie.
    let first: number; // PHONE, placed
    let second: number; // OTHER_PHONE, cancelled
    let third: number; // PHONE, preparing
    let fourth: number; // PHONE, placed
    let fifth: number; // OTHER_PHONE, ready

    beforeEach(() => {
      first = place(db, sampleOrder({ createdAt: '2026-10-14T23:20:00.000Z' }));
      second = place(
        db,
        sampleOrder({
          phoneNumber: OTHER_PHONE,
          createdAt: '2026-10-14T23:21:00.000Z',
          items: [line(cheese, [])],
        }),
      );
      third = place(
        db,
        sampleOrder({
          createdAt: '2026-10-14T23:22:00.000Z',
          items: [line(hawaiian, [pepperoni])],
        }),
      );
      fourth = place(
        db,
        sampleOrder({ createdAt: '2026-10-14T23:22:00.000Z', items: [line(cheese, [mushrooms])] }),
      );
      fifth = place(
        db,
        sampleOrder({
          phoneNumber: OTHER_PHONE,
          createdAt: '2026-10-14T23:23:00.000Z',
          items: [line(margherita, [mushrooms, pepperoni], 4)],
        }),
      );
      transitionOrderStatus(db, second, 'cancelled');
      transitionOrderStatus(db, third, 'preparing');
      transitionOrderStatus(db, fifth, 'preparing');
      transitionOrderStatus(db, fifth, 'ready');
    });

    function idsOf(query: OrderDetailsQuery): number[] {
      return listOrderDetails(db, query).map(({ id }) => id);
    }

    it('lists every order newest first, breaking ties by id', () => {
      expect(idsOf({ limit: 10, sort: 'newest' })).toEqual([fifth, fourth, third, second, first]);
    });

    it('lists every order oldest first, breaking ties by id', () => {
      expect(idsOf({ limit: 10, sort: 'oldest' })).toEqual([first, second, third, fourth, fifth]);
    });

    it("returns only one customer's orders when given a phone number", () => {
      expect(idsOf({ phoneNumber: PHONE, limit: 10, sort: 'newest' })).toEqual([
        fourth,
        third,
        first,
      ]);
      expect(idsOf({ phoneNumber: OTHER_PHONE, limit: 10, sort: 'oldest' })).toEqual([
        second,
        fifth,
      ]);
      expect(idsOf({ phoneNumber: '+16175550123', limit: 10, sort: 'newest' })).toEqual([]);
    });

    it('compares phone numbers exactly, leaving normalization to the identity module (ADR 0005)', () => {
      expect(idsOf({ phoneNumber: '(212) 555-0142', limit: 10, sort: 'newest' })).toEqual([]);
    });

    it('returns only orders in the given statuses', () => {
      expect(idsOf({ statuses: ['placed'], limit: 10, sort: 'oldest' })).toEqual([first, fourth]);
      expect(idsOf({ statuses: ['preparing', 'ready'], limit: 10, sort: 'oldest' })).toEqual([
        third,
        fifth,
      ]);
      expect(idsOf({ statuses: ['delivered'], limit: 10, sort: 'oldest' })).toEqual([]);
      expect(idsOf({ statuses: [], limit: 10, sort: 'oldest' })).toEqual([]);
    });

    it('applies the phone number and the statuses together', () => {
      expect(
        idsOf({ phoneNumber: PHONE, statuses: ['placed'], limit: 10, sort: 'newest' }),
      ).toEqual([fourth, first]);
      expect(
        idsOf({
          phoneNumber: OTHER_PHONE,
          statuses: ['placed', 'preparing', 'ready'],
          limit: 10,
          sort: 'oldest',
        }),
      ).toEqual([fifth]);
    });

    it('returns at most `limit` orders, from the front of the sort', () => {
      expect(idsOf({ limit: 2, sort: 'newest' })).toEqual([fifth, fourth]);
      expect(idsOf({ limit: 2, sort: 'oldest' })).toEqual([first, second]);
      expect(idsOf({ phoneNumber: PHONE, limit: 1, sort: 'oldest' })).toEqual([first]);
      expect(idsOf({ statuses: ['placed'], limit: 1, sort: 'newest' })).toEqual([fourth]);
    });

    it('gives each listed order its own lines, toppings, and status history', () => {
      const listed = listOrderDetails(db, { limit: 10, sort: 'oldest' });

      expect(listed).toStrictEqual(
        [first, second, third, fourth, fifth].map((id) => getOrderDetails(db, id)),
      );
      expect(listed.at(-1)).toMatchObject({
        status: 'ready',
        items: [
          {
            menuItemName: 'Margherita',
            quantity: 4,
            toppings: [{ toppingName: 'Mushrooms' }, { toppingName: 'Pepperoni' }],
          },
        ],
        statusEvents: [
          { fromStatus: null, toStatus: 'placed' },
          { fromStatus: 'placed', toStatus: 'preparing' },
          { fromStatus: 'preparing', toStatus: 'ready' },
        ],
      });
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'throws a RangeError for a limit of %s',
      (limit) => {
        expect(() => listOrderDetails(db, { limit, sort: 'newest' })).toThrow(RangeError);
      },
    );

    it('throws a RangeError for an unknown sort', () => {
      const sort = 'created_at; DROP TABLE orders' as OrderSort;

      expect(() => listOrderDetails(db, { limit: 10, sort })).toThrow(RangeError);
      expect(idsOf({ limit: 10, sort: 'oldest' })).toHaveLength(5);
    });
  });

  it('lists nothing from an empty database', () => {
    expect(listOrderDetails(db, { limit: 10, sort: 'newest' })).toEqual([]);
  });
});
