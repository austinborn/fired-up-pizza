import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection';
import { createTestDatabase } from '../test/database';
import { createCatalogRepository, type CatalogRepository } from './catalog';

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
});
