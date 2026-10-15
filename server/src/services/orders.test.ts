import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import { computeOrderTotalCents, computeUnitPriceCents } from '@fired-up-pizza/shared/pricing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/connection';
import { AppError } from '../http/errors';
import { createCatalogRepository, type CatalogRepository } from '../repositories/catalog';
import { getOrderDetails, listOrderDetails } from '../repositories/orders';
import { createTestDatabase } from '../test/database';
import { recordInitialStatus } from './order-status';
import { placeOrder, type PlaceOrderInput } from './orders';
import type { OrderItemSelection } from './pricing';

// The repositories and services run for real. recordInitialStatus and
// getOrderDetails are wrapped so that single tests can make a step fail after
// the order rows are written. vi.resetAllMocks() restores the real behavior
// after each test.
vi.mock(import('./order-status'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordInitialStatus: vi.fn(actual.recordInitialStatus) };
});
vi.mock(import('../repositories/orders'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getOrderDetails: vi.fn(actual.getOrderDetails) };
});

const PHONE = '+12125550142';
const PLACED_AT = '2026-10-14T23:20:00.000Z';

/** The starter catalog row with this name (CATALOG_SEED in server/src/db/seed.ts). */
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

describe('placeOrder', () => {
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
    vi.useRealTimers();
    vi.resetAllMocks();
    db.close();
  });

  /** Two medium Margheritas with stuffed crust, pepperoni, and mushrooms. */
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

  /** One large hand-tossed Hawaiian with no extra toppings. */
  function hawaiianLine(): OrderItemSelection {
    return {
      menuItemId: hawaiian.id,
      sizeId: large.id,
      crustId: handTossed.id,
      toppingIds: [],
      quantity: 1,
    };
  }

  function input(overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
    return {
      customer: { phoneNumber: PHONE },
      notes: 'Ring twice',
      items: [margheritas(), hawaiianLine()],
      ...overrides,
    };
  }

  /** Every stored order. Foreign keys tie each line, topping, and status event to an order. */
  function storedOrders() {
    return listOrderDetails(db, { limit: 100, sort: 'oldest' });
  }

  it('prices the items from the catalog with the shared formula and returns the order as stored', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(PLACED_AT));
    const margheritaUnitCents = computeUnitPriceCents({
      basePriceCents: margherita.basePriceCents,
      sizeMultiplier: medium.priceMultiplier,
      crustDeltaCents: stuffedCrust.priceDeltaCents,
      toppingPricesCents: [pepperoni.priceCents, mushrooms.priceCents],
    });
    const hawaiianUnitCents = computeUnitPriceCents({
      basePriceCents: hawaiian.basePriceCents,
      sizeMultiplier: large.priceMultiplier,
      crustDeltaCents: handTossed.priceDeltaCents,
      toppingPricesCents: [],
    });

    const order = placeOrder(db, input());

    expect(order).toStrictEqual(getOrderDetails(db, order.id));
    expect(order).toStrictEqual({
      id: expect.any(Number),
      phoneNumber: PHONE,
      status: 'placed',
      totalCents: computeOrderTotalCents([
        { unitPriceCents: margheritaUnitCents, quantity: 2 },
        { unitPriceCents: hawaiianUnitCents, quantity: 1 },
      ]),
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
          unitPriceCents: margheritaUnitCents,
          toppings: [
            { toppingId: pepperoni.id, toppingName: 'Pepperoni', priceCents: pepperoni.priceCents },
            { toppingId: mushrooms.id, toppingName: 'Mushrooms', priceCents: mushrooms.priceCents },
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
          unitPriceCents: hawaiianUnitCents,
          toppings: [],
        },
      ],
      statusEvents: [
        { id: expect.any(Number), fromStatus: null, toStatus: 'placed', changedAt: PLACED_AT },
      ],
    });
    // 1099 * 1.25 = 1373.75, charged as 1374, + 200 + 200 + 150; 1399 * 1.5 = 2098.5, charged as 2099.
    expect(order.totalCents).toBe(2 * 1924 + 2099);
  });

  it('keeps the prices it charged when the catalog changes later (ADR 0003 rule 4)', () => {
    const order = placeOrder(db, input());

    expect(catalog.updateMenuItem(margherita.id, { basePriceCents: 1599 }).ok).toBe(true);
    expect(catalog.updateTopping(pepperoni.id, { priceCents: 350, available: false }).ok).toBe(
      true,
    );

    expect(getOrderDetails(db, order.id)).toStrictEqual(order);
  });

  it('charges the catalog prices that hold when the order is placed', () => {
    expect(catalog.updateTopping(mushrooms.id, { priceCents: 175 }).ok).toBe(true);

    const order = placeOrder(db, input({ items: [margheritas({ quantity: 1 })] }));

    // 1374 + 200 + 200 + 175.
    expect(order.items[0]?.unitPriceCents).toBe(1949);
    expect(order.items[0]?.toppings[1]).toEqual({
      toppingId: mushrooms.id,
      toppingName: 'Mushrooms',
      priceCents: 175,
    });
    expect(order.totalCents).toBe(1949);
  });

  it('gives each order its own id and rows', () => {
    const first = placeOrder(db, input());
    const second = placeOrder(
      db,
      input({ customer: { phoneNumber: '+13125550143' }, notes: '', items: [hawaiianLine()] }),
    );

    expect(second.id).not.toBe(first.id);
    expect(storedOrders()).toStrictEqual([first, second]);
  });

  it('writes nothing when an item is unavailable', () => {
    expect(catalog.updateTopping(pepperoni.id, { available: false }).ok).toBe(true);

    const error = errorFrom(() => placeOrder(db, input()));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ITEM_UNAVAILABLE', status: 422 });
    expect(storedOrders()).toEqual([]);
  });

  it('writes nothing when an item breaks the ordering limits', () => {
    const error = errorFrom(() => placeOrder(db, input({ items: [margheritas({ quantity: 0 })] })));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(storedOrders()).toEqual([]);
  });

  it('rolls back the order rows when the initial status event cannot be recorded', () => {
    let insertedId: number | undefined;
    vi.mocked(recordInitialStatus).mockImplementationOnce((_db, orderId) => {
      insertedId = orderId;
      throw new Error('disk I/O error');
    });

    expect(() => placeOrder(db, input())).toThrow('disk I/O error');
    expect(insertedId).toEqual(expect.any(Number));
    expect(getOrderDetails(db, insertedId ?? 0)).toBeUndefined();
    expect(storedOrders()).toEqual([]);
  });

  it('rolls back the order and its status event when the order cannot be read back', () => {
    vi.mocked(getOrderDetails).mockReturnValueOnce(undefined);

    expect(() => placeOrder(db, input())).toThrow('is missing from the transaction');
    expect(recordInitialStatus).toHaveBeenCalledOnce();
    expect(storedOrders()).toEqual([]);
  });
});
