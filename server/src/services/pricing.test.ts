import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import {
  computeOrderTotalCents,
  computeUnitPriceCents,
  MAX_QUANTITY_PER_ITEM,
  MAX_TOPPINGS_PER_ITEM,
} from '@fired-up-pizza/shared/pricing';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import type { Db } from '../db/connection';
import { AppError } from '../http/errors';
import type { ValidationIssue } from '../http/validate';
import { createCatalogRepository, type CatalogRepository } from '../repositories/catalog';
import { createTestDatabase } from '../test/database';
import { priceOrderItems, type OrderItemSelection } from './pricing';

// Every test prices against the starter catalog (CATALOG_SEED in
// server/src/db/seed.ts) and finds rows by name, not by the ids the database
// assigned. The seed's Margherita costs 1099 cents, so a medium one is the
// rounding case from ADR 0003: 1099 * 1.25 = 1373.75, charged as 1374.

const UNKNOWN_ID = 9999;

/** The row with this name. */
function named<Row extends { name: string }>(rows: readonly Row[], name: string): Row {
  const row = rows.find((candidate) => candidate.name === name);
  if (row === undefined) {
    throw new Error(`The starter catalog has no row named ${name}`);
  }
  return row;
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

describe('priceOrderItems', () => {
  let db: Db;
  let catalog: CatalogRepository;
  let margherita: MenuItem;
  let hawaiian: MenuItem;
  let small: Size;
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
    small = named(catalog.listSizes(), 'Small');
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

  /**
   * Two medium Margheritas with stuffed crust, pepperoni, and mushrooms:
   * 1374 + 200 + 200 + 150 = 1924 cents each.
   */
  function margheritas(overrides: Partial<OrderItemSelection> = {}): OrderItemSelection {
    return {
      menuItemId: margherita.id,
      sizeId: medium.id,
      crustId: stuffedCrust.id,
      toppingIds: [pepperoni.id, mushrooms.id],
      quantity: 2,
      ...overrides,
    };
  }

  function hideMenuItem(id: number): void {
    db.prepare('UPDATE menu_items SET available = 0 WHERE id = ?').run(id);
  }

  function hideTopping(id: number): void {
    db.prepare('UPDATE toppings SET available = 0 WHERE id = ?').run(id);
  }

  /** Asserts that pricing `items` throws a 422 ITEM_UNAVAILABLE listing exactly `issues`. */
  function expectUnavailable(items: OrderItemSelection[], issues: ValidationIssue[]): void {
    const error = errorFrom(() => priceOrderItems(db, items));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      status: 422,
      message: 'Some of the items in this order are not available',
    });
    expect(error).toHaveProperty('details', { issues });
  }

  /** Asserts that pricing `items` throws a 400 VALIDATION_ERROR listing exactly `issues`. */
  function expectInvalid(items: OrderItemSelection[], issues: ValidationIssue[]): void {
    const error = errorFrom(() => priceOrderItems(db, items));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Request validation failed',
    });
    expect(error).toHaveProperty('details', { issues });
  }

  it('prices an item from the current catalog rows', () => {
    expect(priceOrderItems(db, [margheritas()])).toStrictEqual({
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
      ],
      totalCents: 3848,
    });
  });

  it('keeps the requested order of items and toppings and totals every line', () => {
    // Pepperoni has the lower id but Mushrooms sorts first by name, so sorting
    // the toppings by either one breaks one of these two orders.
    const priced = priceOrderItems(db, [
      margheritas({ quantity: 1 }),
      // 1399 * 1.5 = 2098.5, charged as 2099.
      {
        menuItemId: hawaiian.id,
        sizeId: large.id,
        crustId: handTossed.id,
        toppingIds: [],
        quantity: 3,
      },
      margheritas({
        sizeId: small.id,
        crustId: handTossed.id,
        toppingIds: [mushrooms.id, pepperoni.id],
        quantity: 20,
      }),
    ]);

    expect(priced.items).toMatchObject([
      {
        menuItemId: margherita.id,
        quantity: 1,
        unitPriceCents: 1924,
        toppings: [{ toppingId: pepperoni.id }, { toppingId: mushrooms.id }],
      },
      { menuItemId: hawaiian.id, quantity: 3, unitPriceCents: 2099, toppings: [] },
      {
        menuItemId: margherita.id,
        quantity: 20,
        unitPriceCents: 1099 + 150 + 200,
        toppings: [{ toppingId: mushrooms.id }, { toppingId: pepperoni.id }],
      },
    ]);
    expect(priced.totalCents).toBe(1924 + 3 * 2099 + 20 * 1449);
    expect(priced.totalCents).toBe(computeOrderTotalCents(priced.items));
  });

  it('charges what the shared formula estimates, for every size and crust (ADR 0003)', () => {
    for (const size of catalog.listSizes()) {
      for (const crust of catalog.listCrusts()) {
        const [item] = priceOrderItems(db, [
          margheritas({ sizeId: size.id, crustId: crust.id }),
        ]).items;

        expect(item?.unitPriceCents).toBe(
          computeUnitPriceCents({
            basePriceCents: margherita.basePriceCents,
            sizeMultiplier: size.priceMultiplier,
            crustDeltaCents: crust.priceDeltaCents,
            toppingPricesCents: [pepperoni.priceCents, mushrooms.priceCents],
          }),
        );
      }
    }
  });

  it('reads the prices the catalog holds when it is called', () => {
    db.prepare('UPDATE menu_items SET base_price_cents = 1199 WHERE id = ?').run(margherita.id);
    db.prepare('UPDATE toppings SET price_cents = 300 WHERE id = ?').run(pepperoni.id);

    // 1199 * 1.25 = 1498.75, charged as 1499; then the crust and toppings.
    expect(priceOrderItems(db, [margheritas()]).items[0]).toMatchObject({
      unitPriceCents: 1499 + 200 + 300 + 150,
      toppings: [
        { toppingId: pepperoni.id, priceCents: 300 },
        { toppingId: mushrooms.id, priceCents: 150 },
      ],
    });
  });

  it('takes only ids and quantities, never prices, from the request (ADR 0003 rule 3)', () => {
    expectTypeOf<OrderItemSelection>().toEqualTypeOf<{
      menuItemId: number;
      sizeId: number;
      crustId: number;
      toppingIds: readonly number[];
      quantity: number;
    }>();

    // Price fields a client might send, in case a route ever let them through.
    const withClientPrices = {
      ...margheritas(),
      unitPriceCents: 1,
      priceCents: 1,
      totalCents: 1,
      toppings: [{ toppingId: pepperoni.id, priceCents: 0 }],
    };

    expect(priceOrderItems(db, [withClientPrices])).toStrictEqual(
      priceOrderItems(db, [margheritas()]),
    );
  });

  it('accepts the most pizzas and toppings the ordering limits allow', () => {
    const toppingIds = catalog
      .listToppings()
      .slice(0, MAX_TOPPINGS_PER_ITEM)
      .map(({ id }) => id);

    const [item] = priceOrderItems(db, [
      margheritas({ toppingIds, quantity: MAX_QUANTITY_PER_ITEM }),
    ]).items;

    expect(item?.quantity).toBe(MAX_QUANTITY_PER_ITEM);
    expect(item?.toppings.map(({ toppingId }) => toppingId)).toEqual(toppingIds);
  });

  it.each([0, -1, MAX_QUANTITY_PER_ITEM + 1, 1.5, Number.NaN])(
    'rejects a quantity of %s with a 400 VALIDATION_ERROR',
    (quantity) => {
      expectInvalid(
        [margheritas({ quantity })],
        [{ path: 'items.0.quantity', message: 'Quantity must be a whole number from 1 to 20' }],
      );
    },
  );

  it('rejects more toppings than MAX_TOPPINGS_PER_ITEM with a 400 VALIDATION_ERROR', () => {
    const toppingIds = catalog
      .listToppings()
      .slice(0, MAX_TOPPINGS_PER_ITEM + 1)
      .map(({ id }) => id);

    expectInvalid(
      [margheritas({ toppingIds })],
      [{ path: 'items.0.toppingIds', message: 'A pizza can have at most 10 toppings' }],
    );
  });

  it('rejects a topping listed twice with a 400 VALIDATION_ERROR', () => {
    expectInvalid(
      [margheritas({ toppingIds: [pepperoni.id, mushrooms.id, pepperoni.id] })],
      [{ path: 'items.0.toppingIds', message: 'Each topping can be added only once' }],
    );
  });

  it('checks every limit before it looks anything up', () => {
    expectInvalid(
      [
        margheritas({ menuItemId: UNKNOWN_ID, quantity: 0 }),
        margheritas(),
        margheritas({ toppingIds: [UNKNOWN_ID, UNKNOWN_ID] }),
      ],
      [
        { path: 'items.0.quantity', message: 'Quantity must be a whole number from 1 to 20' },
        { path: 'items.2.toppingIds', message: 'Each topping can be added only once' },
      ],
    );
  });

  it('rejects an unknown menu item with a 422 ITEM_UNAVAILABLE', () => {
    expectUnavailable(
      [margheritas({ menuItemId: UNKNOWN_ID })],
      [{ path: 'items.0.menuItemId', message: `Menu item ${UNKNOWN_ID} is not available` }],
    );
  });

  it('rejects a hidden menu item with a 422 ITEM_UNAVAILABLE', () => {
    hideMenuItem(margherita.id);

    expectUnavailable(
      [margheritas()],
      [{ path: 'items.0.menuItemId', message: `Menu item ${margherita.id} is not available` }],
    );
  });

  it('rejects an unknown size with a 422 ITEM_UNAVAILABLE', () => {
    expectUnavailable(
      [margheritas({ sizeId: UNKNOWN_ID })],
      [{ path: 'items.0.sizeId', message: `Size ${UNKNOWN_ID} is not available` }],
    );
  });

  it('rejects an unknown crust with a 422 ITEM_UNAVAILABLE', () => {
    expectUnavailable(
      [margheritas({ crustId: UNKNOWN_ID })],
      [{ path: 'items.0.crustId', message: `Crust ${UNKNOWN_ID} is not available` }],
    );
  });

  it('rejects an unknown topping with a 422 ITEM_UNAVAILABLE', () => {
    expectUnavailable(
      [margheritas({ toppingIds: [pepperoni.id, UNKNOWN_ID] })],
      [{ path: 'items.0.toppingIds.1', message: `Topping ${UNKNOWN_ID} is not available` }],
    );
  });

  it('rejects a hidden topping with a 422 ITEM_UNAVAILABLE', () => {
    hideTopping(pepperoni.id);

    expectUnavailable(
      [margheritas()],
      [{ path: 'items.0.toppingIds.0', message: `Topping ${pepperoni.id} is not available` }],
    );
  });

  it('reports every unavailable choice in the order at once', () => {
    hideTopping(mushrooms.id);

    expectUnavailable(
      [
        margheritas({ crustId: UNKNOWN_ID }),
        margheritas(),
        margheritas({ menuItemId: UNKNOWN_ID, sizeId: UNKNOWN_ID, toppingIds: [] }),
      ],
      [
        { path: 'items.0.crustId', message: `Crust ${UNKNOWN_ID} is not available` },
        { path: 'items.0.toppingIds.1', message: `Topping ${mushrooms.id} is not available` },
        { path: 'items.1.toppingIds.1', message: `Topping ${mushrooms.id} is not available` },
        { path: 'items.2.menuItemId', message: `Menu item ${UNKNOWN_ID} is not available` },
        { path: 'items.2.sizeId', message: `Size ${UNKNOWN_ID} is not available` },
      ],
    );
  });

  it('only reads, so it can run inside the place-order transaction', () => {
    const changesSoFar = db.prepare<[], number>('SELECT total_changes()').pluck();
    const before = changesSoFar.get();

    const priced = db.transaction(() => priceOrderItems(db, [margheritas()]))();

    expect(priced).toStrictEqual(priceOrderItems(db, [margheritas()]));
    expect(changesSoFar.get()).toBe(before);
  });
});
