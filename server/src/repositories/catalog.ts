import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import type { Db } from '../db/connection';

export interface CatalogListOptions {
  /** Also return hidden rows (`available: false`). Staff views set it; customer views never do. */
  includeUnavailable?: boolean;
}

/**
 * Catalog reads as shared domain types (ADR 0002 rule 6). Menu items and
 * toppings can be hidden (`available: false`) but never deleted, because orders
 * keep referencing them (ADR 0002 rule 7). Lookups by id therefore return hidden
 * rows too, and the caller decides whether a hidden row is usable.
 */
export interface CatalogRepository {
  /** Menu items ordered by category, then name, both ignoring case. */
  listMenuItems: (options?: CatalogListOptions) => MenuItem[];
  /** The menu item with this id, hidden or not, or undefined. */
  getMenuItem: (id: number) => MenuItem | undefined;
  /** Every size, smallest price multiplier first. */
  listSizes: () => Size[];
  /** The size with this id, or undefined. */
  getSize: (id: number) => Size | undefined;
  /** Every crust, cheapest first, then by name. */
  listCrusts: () => Crust[];
  /** The crust with this id, or undefined. */
  getCrust: (id: number) => Crust | undefined;
  /** Toppings ordered by name, ignoring case. */
  listToppings: (options?: CatalogListOptions) => Topping[];
  /**
   * The toppings with these ids, hidden or not, ordered by name. Unknown ids are
   * left out and repeated ids return one row, so compare the result with the
   * request to find what is missing.
   */
  getToppingsByIds: (ids: readonly number[]) => Topping[];
}

/** SQLite stores booleans as 0/1 (ADR 0002 rule 6). */
type StoredFlag = 0 | 1;

/** The SELECTs alias columns to the domain field names, so only `available` needs mapping. */
type MenuItemRow = Omit<MenuItem, 'available'> & { available: StoredFlag };
type ToppingRow = Omit<Topping, 'available'> & { available: StoredFlag };

interface ListParams {
  includeUnavailable: StoredFlag;
}

function toMenuItem(row: MenuItemRow): MenuItem {
  return { ...row, available: row.available === 1 };
}

function toTopping(row: ToppingRow): Topping {
  return { ...row, available: row.available === 1 };
}

function listParams({ includeUnavailable = false }: CatalogListOptions = {}): ListParams {
  return { includeUnavailable: includeUnavailable ? 1 : 0 };
}

/**
 * Prepares every catalog statement once, against a migrated database (see
 * server/src/db/migrate.ts). Callers create one repository and reuse it, e.g.
 * once per router factory.
 */
export function createCatalogRepository(db: Db): CatalogRepository {
  const selectMenuItems = db.prepare<ListParams, MenuItemRow>(
    `SELECT id, name, description, category, base_price_cents AS basePriceCents, available,
            created_at AS createdAt
     FROM menu_items
     WHERE available = 1 OR @includeUnavailable = 1
     ORDER BY category COLLATE NOCASE, name`,
  );
  const selectMenuItem = db.prepare<[number], MenuItemRow>(
    `SELECT id, name, description, category, base_price_cents AS basePriceCents, available,
            created_at AS createdAt
     FROM menu_items
     WHERE id = ?`,
  );
  const selectSizes = db.prepare<[], Size>(
    `SELECT id, name, price_multiplier AS priceMultiplier
     FROM sizes
     ORDER BY price_multiplier, name`,
  );
  const selectSize = db.prepare<[number], Size>(
    'SELECT id, name, price_multiplier AS priceMultiplier FROM sizes WHERE id = ?',
  );
  const selectCrusts = db.prepare<[], Crust>(
    `SELECT id, name, price_delta_cents AS priceDeltaCents
     FROM crusts
     ORDER BY price_delta_cents, name`,
  );
  const selectCrust = db.prepare<[number], Crust>(
    'SELECT id, name, price_delta_cents AS priceDeltaCents FROM crusts WHERE id = ?',
  );
  const selectToppings = db.prepare<ListParams, ToppingRow>(
    `SELECT id, name, price_cents AS priceCents, available
     FROM toppings
     WHERE available = 1 OR @includeUnavailable = 1
     ORDER BY name`,
  );
  // The ids arrive as one JSON array parameter, so a single prepared statement
  // serves any number of ids without building SQL (ADR 0002 rule 5).
  const selectToppingsByIds = db.prepare<[string], ToppingRow>(
    `SELECT id, name, price_cents AS priceCents, available
     FROM toppings
     WHERE id IN (SELECT value FROM json_each(?))
     ORDER BY name`,
  );

  return {
    listMenuItems: (options) => selectMenuItems.all(listParams(options)).map(toMenuItem),
    getMenuItem: (id) => {
      const row = selectMenuItem.get(id);
      return row === undefined ? undefined : toMenuItem(row);
    },
    listSizes: () => selectSizes.all(),
    getSize: (id) => selectSize.get(id),
    listCrusts: () => selectCrusts.all(),
    getCrust: (id) => selectCrust.get(id),
    listToppings: (options) => selectToppings.all(listParams(options)).map(toTopping),
    getToppingsByIds: (ids) =>
      ids.length === 0 ? [] : selectToppingsByIds.all(JSON.stringify(ids)).map(toTopping),
  };
}
