import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection';
import { createTestDatabase } from '../test/database';
import {
  createCatalogRepository,
  type CatalogRepository,
  type CatalogWriteResult,
  type MenuItemFields,
  type ToppingFields,
} from './catalog';

// Each test builds its own catalog, inserted out of order with hidden rows and
// mixed-case names, so ordering, filtering, and mapping are all visible.

const CREATED_AT = '2026-10-14T23:20:00.000Z';

function insertMenuItem(db: Db, name: string, category: string, available: 0 | 1 = 1): number {
  return Number(
    db
      .prepare(
        `INSERT INTO menu_items (name, description, category, base_price_cents, available, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(name, `About ${name}`, category, 1099, available, CREATED_AT).lastInsertRowid,
  );
}

function insertSize(db: Db, name: string, priceMultiplier: number): number {
  return Number(
    db
      .prepare('INSERT INTO sizes (name, price_multiplier) VALUES (?, ?)')
      .run(name, priceMultiplier).lastInsertRowid,
  );
}

function insertCrust(db: Db, name: string, priceDeltaCents: number): number {
  return Number(
    db
      .prepare('INSERT INTO crusts (name, price_delta_cents) VALUES (?, ?)')
      .run(name, priceDeltaCents).lastInsertRowid,
  );
}

function insertTopping(db: Db, name: string, priceCents: number, available: 0 | 1 = 1): number {
  return Number(
    db
      .prepare('INSERT INTO toppings (name, price_cents, available) VALUES (?, ?, ?)')
      .run(name, priceCents, available).lastInsertRowid,
  );
}

/** The written row; fails the test when the write was refused. */
function written<T>(result: CatalogWriteResult<T>): T {
  if (!result.ok) {
    throw new Error(`Expected the write to succeed, but it failed with ${result.failure}`);
  }
  return result.value;
}

describe('createCatalogRepository', () => {
  let db: Db;
  let catalog: CatalogRepository;

  beforeEach(() => {
    db = createTestDatabase();
    catalog = createCatalogRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty lists for an empty catalog', () => {
    expect(catalog.listMenuItems({ includeUnavailable: true })).toEqual([]);
    expect(catalog.listSizes()).toEqual([]);
    expect(catalog.listCrusts()).toEqual([]);
    expect(catalog.listToppings({ includeUnavailable: true })).toEqual([]);
  });

  it('sees rows written after it was created', () => {
    insertSize(db, 'Small', 1);

    expect(catalog.listSizes()).toHaveLength(1);
  });

  describe('menu items', () => {
    let pepperoni: number;
    let hawaiian: number;
    let calzone: number;
    let margherita: number;

    beforeEach(() => {
      pepperoni = insertMenuItem(db, 'Pepperoni', 'Classic');
      hawaiian = insertMenuItem(db, 'Hawaiian', 'Specialty', 0);
      calzone = insertMenuItem(db, 'calzone', 'baked');
      margherita = insertMenuItem(db, 'Margherita', 'Classic');
    });

    it('maps a row to the shared MenuItem type', () => {
      expect(catalog.getMenuItem(margherita)).toStrictEqual({
        id: margherita,
        name: 'Margherita',
        description: 'About Margherita',
        category: 'Classic',
        basePriceCents: 1099,
        available: true,
        createdAt: CREATED_AT,
      });
    });

    it('lists available items by category, then name, ignoring case', () => {
      expect(catalog.listMenuItems().map((item) => item.id)).toEqual([
        calzone,
        margherita,
        pepperoni,
      ]);
      expect(catalog.listMenuItems({ includeUnavailable: false })).toEqual(catalog.listMenuItems());
    });

    it('lists hidden items too when asked, as available: false', () => {
      const items = catalog.listMenuItems({ includeUnavailable: true });

      expect(items.map((item) => item.id)).toEqual([calzone, margherita, pepperoni, hawaiian]);
      expect(items.map((item) => item.available)).toEqual([true, true, true, false]);
    });

    it('gets an item by id even when it is hidden, and undefined for an unknown id', () => {
      expect(catalog.getMenuItem(hawaiian)).toMatchObject({ name: 'Hawaiian', available: false });
      expect(catalog.getMenuItem(9999)).toBeUndefined();
    });
  });

  describe('sizes', () => {
    it('lists sizes smallest multiplier first and gets one by id', () => {
      const large = insertSize(db, 'Large', 1.5);
      const small = insertSize(db, 'Small', 1);
      const medium = insertSize(db, 'Medium', 1.25);

      expect(catalog.listSizes()).toStrictEqual([
        { id: small, name: 'Small', priceMultiplier: 1 },
        { id: medium, name: 'Medium', priceMultiplier: 1.25 },
        { id: large, name: 'Large', priceMultiplier: 1.5 },
      ]);
      expect(catalog.getSize(medium)).toStrictEqual({
        id: medium,
        name: 'Medium',
        priceMultiplier: 1.25,
      });
      expect(catalog.getSize(9999)).toBeUndefined();
    });
  });

  describe('crusts', () => {
    it('lists crusts cheapest first, then by name, and gets one by id', () => {
      const glutenFree = insertCrust(db, 'Gluten-Free', 300);
      const thin = insertCrust(db, 'thin', 0);
      const handTossed = insertCrust(db, 'Hand-Tossed', 0);

      expect(catalog.listCrusts()).toStrictEqual([
        { id: handTossed, name: 'Hand-Tossed', priceDeltaCents: 0 },
        { id: thin, name: 'thin', priceDeltaCents: 0 },
        { id: glutenFree, name: 'Gluten-Free', priceDeltaCents: 300 },
      ]);
      expect(catalog.getCrust(glutenFree)).toStrictEqual({
        id: glutenFree,
        name: 'Gluten-Free',
        priceDeltaCents: 300,
      });
      expect(catalog.getCrust(9999)).toBeUndefined();
    });
  });

  describe('toppings', () => {
    let pepperoni: number;
    let mushrooms: number;
    let anchovies: number;
    let basil: number;

    beforeEach(() => {
      pepperoni = insertTopping(db, 'Pepperoni', 200);
      mushrooms = insertTopping(db, 'Mushrooms', 150, 0);
      anchovies = insertTopping(db, 'anchovies', 175);
      basil = insertTopping(db, 'Basil', 100);
    });

    it('lists available toppings by name, ignoring case, as shared Topping objects', () => {
      expect(catalog.listToppings()).toStrictEqual([
        { id: anchovies, name: 'anchovies', priceCents: 175, available: true },
        { id: basil, name: 'Basil', priceCents: 100, available: true },
        { id: pepperoni, name: 'Pepperoni', priceCents: 200, available: true },
      ]);
    });

    it('lists hidden toppings too when asked, as available: false', () => {
      const toppings = catalog.listToppings({ includeUnavailable: true });

      expect(toppings.map((topping) => topping.id)).toEqual([
        anchovies,
        basil,
        mushrooms,
        pepperoni,
      ]);
      expect(toppings[2]).toStrictEqual({
        id: mushrooms,
        name: 'Mushrooms',
        priceCents: 150,
        available: false,
      });
    });

    it('gets toppings by id, hidden ones included, ordered by name', () => {
      expect(catalog.getToppingsByIds([pepperoni, mushrooms, basil])).toStrictEqual([
        { id: basil, name: 'Basil', priceCents: 100, available: true },
        { id: mushrooms, name: 'Mushrooms', priceCents: 150, available: false },
        { id: pepperoni, name: 'Pepperoni', priceCents: 200, available: true },
      ]);
    });

    it('leaves out unknown ids and returns a repeated id once', () => {
      const toppings = catalog.getToppingsByIds([basil, 9999, basil, -1]);

      expect(toppings.map((topping) => topping.id)).toEqual([basil]);
    });

    it('returns nothing for no ids', () => {
      expect(catalog.getToppingsByIds([])).toEqual([]);
    });
  });

  describe('menu item writes', () => {
    const margherita: MenuItemFields = {
      name: 'Margherita',
      description: 'Tomato, mozzarella, and basil',
      category: 'Classic',
      basePriceCents: 1099,
      available: true,
    };

    it('creates an item with a new id and the current time as createdAt', () => {
      const before = new Date().toISOString();
      const item = written(catalog.createMenuItem(margherita));
      const after = new Date().toISOString();

      expect(item).toStrictEqual({
        ...margherita,
        id: expect.any(Number),
        createdAt: expect.any(String),
      });
      expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(item.createdAt >= before && item.createdAt <= after).toBe(true);
      expect(catalog.getMenuItem(item.id)).toStrictEqual(item);
      expect(catalog.listMenuItems()).toStrictEqual([item]);
    });

    it('creates a hidden item that only the staff list shows', () => {
      const item = written(catalog.createMenuItem({ ...margherita, available: false }));

      expect(item.available).toBe(false);
      expect(catalog.listMenuItems()).toEqual([]);
      expect(catalog.listMenuItems({ includeUnavailable: true })).toStrictEqual([item]);
    });

    it('refuses a name another item has, ignoring case, and writes nothing', () => {
      insertMenuItem(db, 'Pepperoni', 'Classic', 0);

      expect(catalog.createMenuItem({ ...margherita, name: 'PEPPERONI' })).toStrictEqual({
        ok: false,
        failure: 'name-taken',
      });
      expect(catalog.listMenuItems({ includeUnavailable: true })).toHaveLength(1);
    });

    it('changes only the given fields and keeps createdAt', () => {
      const item = written(catalog.createMenuItem(margherita));

      const updated = written(
        catalog.updateMenuItem(item.id, { description: '', basePriceCents: 1149 }),
      );

      expect(updated).toStrictEqual({ ...item, description: '', basePriceCents: 1149 });
      expect(catalog.getMenuItem(item.id)).toStrictEqual(updated);
    });

    it('changes every field at once', () => {
      const item = written(catalog.createMenuItem(margherita));
      const changes: MenuItemFields = {
        name: 'Margherita DOP',
        description: 'Buffalo mozzarella',
        category: 'Specialty',
        basePriceCents: 1399,
        available: false,
      };

      expect(written(catalog.updateMenuItem(item.id, changes))).toStrictEqual({
        ...item,
        ...changes,
      });
    });

    it('hides an item from the customer list and shows it again', () => {
      const item = written(catalog.createMenuItem(margherita));

      expect(written(catalog.updateMenuItem(item.id, { available: false }))).toStrictEqual({
        ...item,
        available: false,
      });
      expect(catalog.listMenuItems()).toEqual([]);

      expect(written(catalog.updateMenuItem(item.id, { available: true }))).toStrictEqual(item);
      expect(catalog.listMenuItems()).toStrictEqual([item]);
    });

    it('keeps a hidden item hidden when other fields change', () => {
      const item = written(catalog.createMenuItem({ ...margherita, available: false }));

      expect(written(catalog.updateMenuItem(item.id, { basePriceCents: 1199 }))).toStrictEqual({
        ...item,
        basePriceCents: 1199,
      });
      expect(catalog.listMenuItems()).toEqual([]);
    });

    it('returns the item unchanged when given no changes', () => {
      const item = written(catalog.createMenuItem(margherita));

      expect(written(catalog.updateMenuItem(item.id, {}))).toStrictEqual(item);
    });

    it('reports an unknown id as not-found', () => {
      expect(catalog.updateMenuItem(9999, { available: false })).toStrictEqual({
        ok: false,
        failure: 'not-found',
      });
      expect(catalog.updateMenuItem(9999, {})).toStrictEqual({ ok: false, failure: 'not-found' });
    });

    it("refuses another item's name, ignoring case, and changes nothing", () => {
      const item = written(catalog.createMenuItem(margherita));
      insertMenuItem(db, 'Pepperoni', 'Classic');

      expect(
        catalog.updateMenuItem(item.id, { name: 'pepperoni', basePriceCents: 1 }),
      ).toStrictEqual({ ok: false, failure: 'name-taken' });
      expect(catalog.getMenuItem(item.id)).toStrictEqual(item);
    });

    it('lets an item change the case of its own name', () => {
      const item = written(catalog.createMenuItem(margherita));

      expect(written(catalog.updateMenuItem(item.id, { name: 'MARGHERITA' })).name).toBe(
        'MARGHERITA',
      );
    });
  });

  describe('topping writes', () => {
    const basil: ToppingFields = { name: 'Basil', priceCents: 100, available: true };

    it('creates a topping with a new id', () => {
      const topping = written(catalog.createTopping(basil));

      expect(topping).toStrictEqual({ ...basil, id: expect.any(Number) });
      expect(catalog.getToppingsByIds([topping.id])).toStrictEqual([topping]);
      expect(catalog.listToppings()).toStrictEqual([topping]);
    });

    it('creates a hidden topping that only the staff list shows', () => {
      const topping = written(catalog.createTopping({ ...basil, available: false }));

      expect(topping.available).toBe(false);
      expect(catalog.listToppings()).toEqual([]);
      expect(catalog.listToppings({ includeUnavailable: true })).toStrictEqual([topping]);
    });

    it('refuses a name another topping has, ignoring case, and writes nothing', () => {
      insertTopping(db, 'Mushrooms', 150, 0);

      expect(catalog.createTopping({ ...basil, name: 'mushrooms' })).toStrictEqual({
        ok: false,
        failure: 'name-taken',
      });
      expect(catalog.listToppings({ includeUnavailable: true })).toHaveLength(1);
    });

    it('allows a topping to share a name with a menu item', () => {
      insertMenuItem(db, 'Pepperoni', 'Classic');

      expect(catalog.createTopping({ ...basil, name: 'Pepperoni' }).ok).toBe(true);
    });

    it('changes only the given fields', () => {
      const topping = written(catalog.createTopping(basil));

      expect(written(catalog.updateTopping(topping.id, { priceCents: 125 }))).toStrictEqual({
        ...topping,
        priceCents: 125,
      });
      expect(written(catalog.updateTopping(topping.id, { name: 'Fresh Basil' }))).toStrictEqual({
        ...topping,
        name: 'Fresh Basil',
        priceCents: 125,
      });
    });

    it('hides a topping from the customer list and shows it again', () => {
      const topping = written(catalog.createTopping(basil));

      expect(written(catalog.updateTopping(topping.id, { available: false })).available).toBe(
        false,
      );
      expect(catalog.listToppings()).toEqual([]);

      expect(written(catalog.updateTopping(topping.id, { available: true }))).toStrictEqual(
        topping,
      );
      expect(catalog.listToppings()).toStrictEqual([topping]);
    });

    it('keeps a hidden topping hidden when other fields change', () => {
      const topping = written(catalog.createTopping({ ...basil, available: false }));

      expect(written(catalog.updateTopping(topping.id, { priceCents: 125 }))).toStrictEqual({
        ...topping,
        priceCents: 125,
      });
      expect(catalog.listToppings()).toEqual([]);
    });

    it('returns the topping unchanged when given no changes', () => {
      const topping = written(catalog.createTopping(basil));

      expect(written(catalog.updateTopping(topping.id, {}))).toStrictEqual(topping);
    });

    it('reports an unknown id as not-found', () => {
      expect(catalog.updateTopping(9999, { priceCents: 1 })).toStrictEqual({
        ok: false,
        failure: 'not-found',
      });
    });

    it("refuses another topping's name, ignoring case, and changes nothing", () => {
      const topping = written(catalog.createTopping(basil));
      insertTopping(db, 'Pineapple', 150);

      expect(catalog.updateTopping(topping.id, { name: 'PINEAPPLE' })).toStrictEqual({
        ok: false,
        failure: 'name-taken',
      });
      expect(catalog.getToppingsByIds([topping.id])).toStrictEqual([topping]);
    });

    it('lets a topping change the case of its own name', () => {
      const topping = written(catalog.createTopping(basil));

      expect(written(catalog.updateTopping(topping.id, { name: 'BASIL' })).name).toBe('BASIL');
    });
  });

  it('never changes an existing order when staff edit or hide what it references', () => {
    const pizza = written(
      catalog.createMenuItem({
        name: 'Margherita',
        description: '',
        category: 'Classic',
        basePriceCents: 1099,
        available: true,
      }),
    );
    const topping = written(
      catalog.createTopping({ name: 'Basil', priceCents: 100, available: true }),
    );
    const size = insertSize(db, 'Small', 1);
    const crust = insertCrust(db, 'Thin', 0);
    const orderId = db
      .prepare(
        `INSERT INTO orders (phone_number, status, total_cents, notes, created_at, updated_at)
         VALUES (?, 'placed', 1199, '', ?, ?)`,
      )
      .run('+12125550142', CREATED_AT, CREATED_AT).lastInsertRowid;
    const orderItemId = db
      .prepare(
        `INSERT INTO order_items (order_id, menu_item_id, size_id, crust_id, quantity, unit_price_cents)
         VALUES (?, ?, ?, ?, 1, 1199)`,
      )
      .run(orderId, pizza.id, size, crust).lastInsertRowid;
    db.prepare(
      'INSERT INTO order_item_toppings (order_item_id, topping_id, price_cents) VALUES (?, ?, 100)',
    ).run(orderItemId, topping.id);
    const orderRows = () =>
      db
        .prepare(
          `SELECT o.total_cents, i.menu_item_id, i.unit_price_cents, t.topping_id, t.price_cents
           FROM orders o
           JOIN order_items i ON i.order_id = o.id
           JOIN order_item_toppings t ON t.order_item_id = i.id`,
        )
        .all();
    const snapshot = [
      {
        total_cents: 1199,
        menu_item_id: pizza.id,
        unit_price_cents: 1199,
        topping_id: topping.id,
        price_cents: 100,
      },
    ];
    expect(orderRows()).toEqual(snapshot);

    written(catalog.updateMenuItem(pizza.id, { basePriceCents: 1499, available: false }));
    written(catalog.updateTopping(topping.id, { priceCents: 250, available: false }));

    expect(orderRows()).toEqual(snapshot);
  });
});
