import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import type { Db } from '../db/connection';
import { CATALOG_SEED } from '../db/seed';
import { createCatalogRepository } from '../repositories/catalog';
import { createTestDatabase } from '../test/database';

const CATALOG_PATHS = ['/api/menu-items', '/api/sizes', '/api/crusts', '/api/toppings'];

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// The starter catalog's names in the order each endpoint promises. The seed
// inserts the Specialty pizzas and the toppings in a different order, so the
// tests see the sorting.
const MENU_ITEM_ORDER = [
  'Cheese',
  'Margherita',
  'Pepperoni',
  'BBQ Chicken',
  'Fired Up',
  'Hawaiian',
  'Meat Lovers',
  'Garden Veggie',
  'Mediterranean',
];
const SIZE_ORDER = ['Small', 'Medium', 'Large'];
const CRUST_ORDER = ['Hand-Tossed', 'Thin & Crispy', 'Stuffed Crust', 'Gluten-Free'];
const TOPPING_ORDER = [
  'Bacon',
  'Black Olives',
  'Extra Cheese',
  'Fresh Basil',
  'Green Peppers',
  'Grilled Chicken',
  'Ham',
  'Italian Sausage',
  'Mushrooms',
  'Pepperoni',
  'Pineapple',
  'Red Onions',
];

/** The CATALOG_SEED rows with these names, in the order given. */
function seedRows<Row extends { name: string }>(
  rows: readonly Row[],
  names: readonly string[],
): Row[] {
  return names.map((name) => {
    const row = rows.find((candidate) => candidate.name === name);
    if (row === undefined) {
      throw new Error(`CATALOG_SEED has no row named ${name}`);
    }
    return row;
  });
}

// The expected responses, matched in full with toStrictEqual: exactly the
// shared type's keys, the seed's integer cents, and a boolean `available`.
// SQLite assigns the ids.

function seededMenuItems(names: readonly string[]): MenuItem[] {
  return seedRows(CATALOG_SEED.menuItems, names).map((row) => ({
    id: expect.any(Number),
    ...row,
    available: true,
    createdAt: expect.stringMatching(ISO_UTC),
  }));
}

function seededSizes(names: readonly string[]): Size[] {
  return seedRows(CATALOG_SEED.sizes, names).map((row) => ({ id: expect.any(Number), ...row }));
}

function seededCrusts(names: readonly string[]): Crust[] {
  return seedRows(CATALOG_SEED.crusts, names).map((row) => ({ id: expect.any(Number), ...row }));
}

function seededToppings(names: readonly string[]): Topping[] {
  return seedRows(CATALOG_SEED.toppings, names).map((row) => ({
    id: expect.any(Number),
    ...row,
    available: true,
  }));
}

// Hiding is a staff action that sets available to false and keeps the row
// (ADR 0002 rule 7). The tests hide through the catalog repository's staff
// writes, so they do not depend on the staff catalog API and run no SQL of
// their own (ADR 0002 rule 5).

function hideMenuItem(db: Db, name: string): void {
  const catalog = createCatalogRepository(db);
  const item = catalog
    .listMenuItems({ includeUnavailable: true })
    .find((candidate) => candidate.name === name);
  if (item === undefined) {
    throw new Error(`No menu item named ${name}`);
  }
  expect(catalog.updateMenuItem(item.id, { available: false }).ok).toBe(true);
}

function hideTopping(db: Db, name: string): void {
  const catalog = createCatalogRepository(db);
  const topping = catalog
    .listToppings({ includeUnavailable: true })
    .find((candidate) => candidate.name === name);
  if (topping === undefined) {
    throw new Error(`No topping named ${name}`);
  }
  expect(catalog.updateTopping(topping.id, { available: false }).ok).toBe(true);
}

describe('customer catalog API', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDatabase({ seed: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  describe('GET /api/menu-items', () => {
    it('returns the available menu items as shared MenuItem objects, by category, then name', async () => {
      const res = await request(createApp({ db })).get('/api/menu-items');

      expect(res.status).toBe(200);
      expect(res.type).toBe('application/json');
      expect(res.body).toStrictEqual(seededMenuItems(MENU_ITEM_ORDER));
    });

    it('drops a menu item once it is hidden, whatever the query string asks for', async () => {
      const app = createApp({ db });
      hideMenuItem(db, 'Margherita');

      const listed = await request(app).get('/api/menu-items');
      const askedForHidden = await request(app).get('/api/menu-items?includeUnavailable=true');

      const visible = seededMenuItems(MENU_ITEM_ORDER.filter((name) => name !== 'Margherita'));
      expect(listed.body).toStrictEqual(visible);
      expect(askedForHidden.body).toStrictEqual(visible);
    });
  });

  describe('GET /api/sizes', () => {
    it('returns every size as shared Size objects, smallest multiplier first', async () => {
      const res = await request(createApp({ db })).get('/api/sizes');

      expect(res.status).toBe(200);
      expect(res.type).toBe('application/json');
      expect(res.body).toStrictEqual(seededSizes(SIZE_ORDER));
    });
  });

  describe('GET /api/crusts', () => {
    it('returns every crust as shared Crust objects, cheapest first, then by name', async () => {
      const res = await request(createApp({ db })).get('/api/crusts');

      expect(res.status).toBe(200);
      expect(res.type).toBe('application/json');
      expect(res.body).toStrictEqual(seededCrusts(CRUST_ORDER));
    });
  });

  describe('GET /api/toppings', () => {
    it('returns the available toppings as shared Topping objects, by name', async () => {
      const res = await request(createApp({ db })).get('/api/toppings');

      expect(res.status).toBe(200);
      expect(res.type).toBe('application/json');
      expect(res.body).toStrictEqual(seededToppings(TOPPING_ORDER));
    });

    it('drops a topping once it is hidden, whatever the query string asks for', async () => {
      const app = createApp({ db });
      hideTopping(db, 'Mushrooms');

      const listed = await request(app).get('/api/toppings');
      const askedForHidden = await request(app).get('/api/toppings?includeUnavailable=true');

      const visible = seededToppings(TOPPING_ORDER.filter((name) => name !== 'Mushrooms'));
      expect(listed.body).toStrictEqual(visible);
      expect(askedForHidden.body).toStrictEqual(visible);
    });
  });

  it.each(CATALOG_PATHS)(
    'answers GET %s with an empty array for an empty catalog',
    async (path) => {
      const empty = createTestDatabase();
      try {
        const res = await request(createApp({ db: empty })).get(path);

        expect(res.status).toBe(200);
        expect(res.body).toStrictEqual([]);
      } finally {
        empty.close();
      }
    },
  );

  // The menu page shows an empty array as "menu is being updated", so a broken
  // database must surface as an error the page can retry, not as an empty menu.
  it.each(CATALOG_PATHS)(
    'fails GET %s with a generic 500 once the database stops answering',
    async (path) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const app = createApp({ db });
      db.close();

      const res = await request(app).get(path);

      expect(res.status).toBe(500);
      expect(res.body).toStrictEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
      });
    },
  );
});
