import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../test/database';
import type { Db } from './connection';
import { CATALOG_SEED, seedCatalog, type CatalogSeed } from './seed';

const CATALOG_TABLES = ['menu_items', 'sizes', 'crusts', 'toppings'] as const;

type CatalogTable = (typeof CATALOG_TABLES)[number];

/** One valid row per catalog table, standing in for a row that staff created. */
const STAFF_ROW_SQL: Record<CatalogTable, string> = {
  menu_items: `INSERT INTO menu_items (name, description, category, base_price_cents, created_at)
    VALUES ('Staff Special', '', 'Specials', 1500, '2026-10-14T23:20:00.000Z')`,
  sizes: "INSERT INTO sizes (name, price_multiplier) VALUES ('Party', 2)",
  crusts: "INSERT INTO crusts (name, price_delta_cents) VALUES ('Cauliflower', 350)",
  toppings: "INSERT INTO toppings (name, price_cents) VALUES ('Anchovies', 175)",
};

const COUNT_SQL: Record<CatalogTable, string> = {
  menu_items: 'SELECT count(*) FROM menu_items',
  sizes: 'SELECT count(*) FROM sizes',
  crusts: 'SELECT count(*) FROM crusts',
  toppings: 'SELECT count(*) FROM toppings',
};

function rowCount(db: Db, table: CatalogTable): number {
  return db.prepare<[], number>(COUNT_SQL[table]).pluck().get() ?? 0;
}

/** Every row of every catalog table, for before/after comparisons. */
function catalogRows(db: Db): Record<CatalogTable, unknown[]> {
  return {
    menu_items: db.prepare('SELECT * FROM menu_items ORDER BY id').all(),
    sizes: db.prepare('SELECT * FROM sizes ORDER BY id').all(),
    crusts: db.prepare('SELECT * FROM crusts ORDER BY id').all(),
    toppings: db.prepare('SELECT * FROM toppings ORDER BY id').all(),
  };
}

describe('seedCatalog', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  it('fills an empty catalog with sizes S/M/L, crusts, toppings, and pizzas', () => {
    expect(seedCatalog(db)).toBe(true);

    expect(db.prepare('SELECT name, price_multiplier FROM sizes ORDER BY id').all()).toEqual([
      { name: 'Small', price_multiplier: 1 },
      { name: 'Medium', price_multiplier: 1.25 },
      { name: 'Large', price_multiplier: 1.5 },
    ]);
    expect(rowCount(db, 'crusts')).toBeGreaterThanOrEqual(3);
    expect(rowCount(db, 'toppings')).toBeGreaterThanOrEqual(8);
    expect(rowCount(db, 'menu_items')).toBeGreaterThanOrEqual(6);
    expect(
      db.prepare('SELECT count(DISTINCT category) FROM menu_items').pluck().get(),
    ).toBeGreaterThanOrEqual(2);
  });

  it('writes CATALOG_SEED exactly, with every menu item and topping available', () => {
    seedCatalog(db);

    expect(db.prepare('SELECT name, price_delta_cents FROM crusts ORDER BY id').all()).toEqual(
      CATALOG_SEED.crusts.map((crust) => ({
        name: crust.name,
        price_delta_cents: crust.priceDeltaCents,
      })),
    );
    expect(
      db.prepare('SELECT name, price_cents, available FROM toppings ORDER BY id').all(),
    ).toEqual(
      CATALOG_SEED.toppings.map((topping) => ({
        name: topping.name,
        price_cents: topping.priceCents,
        available: 1,
      })),
    );
    expect(
      db
        .prepare(
          'SELECT name, description, category, base_price_cents, available FROM menu_items ORDER BY id',
        )
        .all(),
    ).toEqual(
      CATALOG_SEED.menuItems.map((item) => ({
        name: item.name,
        description: item.description,
        category: item.category,
        base_price_cents: item.basePriceCents,
        available: 1,
      })),
    );
  });

  it('dates the seeded menu items with the seeding time, in ISO-8601 UTC', () => {
    const before = new Date().toISOString();
    seedCatalog(db);
    const after = new Date().toISOString();

    const createdAt = db.prepare<[], string>('SELECT created_at FROM menu_items').pluck().all();
    for (const value of createdAt) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(value >= before && value <= after).toBe(true);
    }
  });

  it('does nothing the second time', () => {
    seedCatalog(db);
    const seeded = catalogRows(db);

    expect(seedCatalog(db)).toBe(false);
    expect(catalogRows(db)).toEqual(seeded);
  });

  it('never overwrites staff edits, so they survive a restart', () => {
    seedCatalog(db);
    db.prepare("UPDATE toppings SET available = 0 WHERE name = 'Pineapple'").run();
    db.prepare("UPDATE menu_items SET base_price_cents = 1149 WHERE name = 'Margherita'").run();
    db.prepare(STAFF_ROW_SQL.menu_items).run();
    const edited = catalogRows(db);

    expect(seedCatalog(db)).toBe(false);
    expect(catalogRows(db)).toEqual(edited);
  });

  it.each(CATALOG_TABLES)('leaves the catalog alone when only %s has rows', (table) => {
    db.prepare(STAFF_ROW_SQL[table]).run();

    expect(seedCatalog(db)).toBe(false);
    for (const other of CATALOG_TABLES) {
      expect(rowCount(db, other)).toBe(other === table ? 1 : 0);
    }
  });

  it('seeds all or nothing, so a failed seed is retried on the next start', () => {
    const broken: CatalogSeed = {
      ...CATALOG_SEED,
      // Names are unique regardless of case, so this last row fails.
      toppings: [...CATALOG_SEED.toppings, { name: 'PEPPERONI', priceCents: 200 }],
    };

    expect(() => seedCatalog(db, broken)).toThrow('UNIQUE constraint failed: toppings.name');
    for (const table of CATALOG_TABLES) {
      expect(rowCount(db, table)).toBe(0);
    }
    expect(seedCatalog(db)).toBe(true);
  });
});
