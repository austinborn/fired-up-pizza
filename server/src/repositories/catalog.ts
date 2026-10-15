import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import Database from 'better-sqlite3';
import type { Db } from '../db/connection';

export interface CatalogListOptions {
  /** Also return hidden rows (`available: false`). Staff views set it; customer views never do. */
  includeUnavailable?: boolean;
}

/** The menu item fields staff write. The database assigns `id`; creation sets `createdAt`. */
export type MenuItemFields = Omit<MenuItem, 'id' | 'createdAt'>;

/** The topping fields staff write. The database assigns `id`. */
export type ToppingFields = Omit<Topping, 'id'>;

/**
 * Why a catalog write changed nothing:
 * - `not-found`: no row has the id.
 * - `name-taken`: another row of the same kind has the name, ignoring ASCII
 *   letter case (the UNIQUE COLLATE NOCASE name columns in 0001_initial.sql).
 */
export type CatalogWriteFailure = 'not-found' | 'name-taken';

/** The row as written, or why nothing was written. */
export type CatalogWriteResult<T> =
  { ok: true; value: T } | { ok: false; failure: CatalogWriteFailure };

/**
 * Catalog reads and staff writes as shared domain types (ADR 0002 rule 6). Menu
 * items and toppings can be hidden (`available: false`) but never deleted,
 * because orders keep referencing them (ADR 0002 rule 7). Lookups by id
 * therefore return hidden rows too, and the caller decides whether a hidden row
 * is usable. Writes touch only the catalog tables, so existing orders keep their
 * snapshot prices (ADR 0003 rule 4).
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
  /**
   * Adds a menu item, with the current time as `createdAt`. Fails only with
   * `name-taken`.
   */
  createMenuItem: (fields: MenuItemFields) => CatalogWriteResult<MenuItem>;
  /**
   * Changes the given fields of a menu item, hidden or not, and keeps the rest.
   * `{ available: false }` hides it. No changes at all returns the item as it is.
   */
  updateMenuItem: (id: number, changes: Partial<MenuItemFields>) => CatalogWriteResult<MenuItem>;
  /** Adds a topping. Fails only with `name-taken`. */
  createTopping: (fields: ToppingFields) => CatalogWriteResult<Topping>;
  /**
   * Changes the given fields of a topping, hidden or not, and keeps the rest.
   * `{ available: false }` hides it. No changes at all returns the topping as it is.
   */
  updateTopping: (id: number, changes: Partial<ToppingFields>) => CatalogWriteResult<Topping>;
}

/** SQLite stores booleans as 0/1 (ADR 0002 rule 6). */
type StoredFlag = 0 | 1;

/** The SELECTs alias columns to the domain field names, so only `available` needs mapping. */
type MenuItemRow = Omit<MenuItem, 'available'> & { available: StoredFlag };
type ToppingRow = Omit<Topping, 'available'> & { available: StoredFlag };

interface ListParams {
  includeUnavailable: StoredFlag;
}

/** Named parameters of the INSERTs. */
type MenuItemInsertParams = Omit<MenuItemRow, 'id'>;
type ToppingInsertParams = Omit<ToppingRow, 'id'>;

/** Named parameters of the UPDATEs, where null keeps the column's current value. */
type MenuItemPatchParams = Pick<MenuItemRow, 'id'> & {
  [Field in keyof MenuItemFields]: MenuItemRow[Field] | null;
};
type ToppingPatchParams = Pick<ToppingRow, 'id'> & {
  [Field in keyof ToppingFields]: ToppingRow[Field] | null;
};

function toMenuItem(row: MenuItemRow): MenuItem {
  return { ...row, available: row.available === 1 };
}

function toTopping(row: ToppingRow): Topping {
  return { ...row, available: row.available === 1 };
}

function toStoredFlag(value: boolean): StoredFlag {
  return value ? 1 : 0;
}

function listParams({ includeUnavailable = false }: CatalogListOptions = {}): ListParams {
  return { includeUnavailable: toStoredFlag(includeUnavailable) };
}

function menuItemPatchParams(id: number, changes: Partial<MenuItemFields>): MenuItemPatchParams {
  return {
    id,
    name: changes.name ?? null,
    description: changes.description ?? null,
    category: changes.category ?? null,
    basePriceCents: changes.basePriceCents ?? null,
    available: changes.available === undefined ? null : toStoredFlag(changes.available),
  };
}

function toppingPatchParams(id: number, changes: Partial<ToppingFields>): ToppingPatchParams {
  return {
    id,
    name: changes.name ?? null,
    priceCents: changes.priceCents ?? null,
    available: changes.available === undefined ? null : toStoredFlag(changes.available),
  };
}

/**
 * Runs an INSERT or UPDATE ... RETURNING and maps the row it returns.
 * - No row means the UPDATE matched no id: `not-found`. An INSERT always
 *   returns its row.
 * - A UNIQUE violation means the name is taken. The name is the only UNIQUE
 *   column of menu_items and toppings; ids come from the database.
 */
function write<Row, T>(
  statement: () => Row | undefined,
  toDomain: (row: Row) => T,
): CatalogWriteResult<T> {
  let row: Row | undefined;
  try {
    row = statement();
  } catch (error) {
    if (error instanceof Database.SqliteError && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return { ok: false, failure: 'name-taken' };
    }
    throw error;
  }
  return row === undefined
    ? { ok: false, failure: 'not-found' }
    : { ok: true, value: toDomain(row) };
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
  const insertMenuItem = db.prepare<MenuItemInsertParams, MenuItemRow>(
    `INSERT INTO menu_items (name, description, category, base_price_cents, available, created_at)
     VALUES (@name, @description, @category, @basePriceCents, @available, @createdAt)
     RETURNING id, name, description, category, base_price_cents AS basePriceCents, available,
               created_at AS createdAt`,
  );
  // Every catalog column is NOT NULL, so a null parameter can only mean "keep
  // the current value". One fixed statement then serves any subset of fields
  // without building SQL (ADR 0002 rule 5).
  const patchMenuItem = db.prepare<MenuItemPatchParams, MenuItemRow>(
    `UPDATE menu_items
     SET name = coalesce(@name, name),
         description = coalesce(@description, description),
         category = coalesce(@category, category),
         base_price_cents = coalesce(@basePriceCents, base_price_cents),
         available = coalesce(@available, available)
     WHERE id = @id
     RETURNING id, name, description, category, base_price_cents AS basePriceCents, available,
               created_at AS createdAt`,
  );
  const insertTopping = db.prepare<ToppingInsertParams, ToppingRow>(
    `INSERT INTO toppings (name, price_cents, available)
     VALUES (@name, @priceCents, @available)
     RETURNING id, name, price_cents AS priceCents, available`,
  );
  const patchTopping = db.prepare<ToppingPatchParams, ToppingRow>(
    `UPDATE toppings
     SET name = coalesce(@name, name),
         price_cents = coalesce(@priceCents, price_cents),
         available = coalesce(@available, available)
     WHERE id = @id
     RETURNING id, name, price_cents AS priceCents, available`,
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
    createMenuItem: (fields) =>
      write(
        () =>
          insertMenuItem.get({
            ...fields,
            available: toStoredFlag(fields.available),
            createdAt: new Date().toISOString(),
          }),
        toMenuItem,
      ),
    updateMenuItem: (id, changes) =>
      write(() => patchMenuItem.get(menuItemPatchParams(id, changes)), toMenuItem),
    createTopping: (fields) =>
      write(
        () => insertTopping.get({ ...fields, available: toStoredFlag(fields.available) }),
        toTopping,
      ),
    updateTopping: (id, changes) =>
      write(() => patchTopping.get(toppingPatchParams(id, changes)), toTopping),
  };
}
