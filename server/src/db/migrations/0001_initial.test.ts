import { ORDER_STATUSES } from '@fired-up-pizza/shared';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, type Db } from '../connection';
import { loadMigrations, migrate } from '../migrate';

// These tests apply 0001 on its own. An applied migration never changes
// (ADR 0002 rule 3), so they keep passing after later migrations land.

const INITIAL_MIGRATION = loadMigrations().filter((m) => m.version === 1);

const NOW = '2026-10-14T23:20:00.000Z';

const DOMAIN_TABLES = [
  'menu_items',
  'sizes',
  'crusts',
  'toppings',
  'orders',
  'order_items',
  'order_item_toppings',
  'order_status_events',
] as const;

/** Tables that get one row (id 1) before each test, for the others to reference. */
const REFERENCED_TABLES = [
  'menu_items',
  'sizes',
  'crusts',
  'toppings',
  'orders',
  'order_items',
] as const;

const CATALOG_TABLES = ['menu_items', 'sizes', 'crusts', 'toppings'] as const;

const STATUS_COLUMNS = [
  ['orders', 'status'],
  ['order_status_events', 'from_status'],
  ['order_status_events', 'to_status'],
] as const;

type Table = (typeof DOMAIN_TABLES)[number];
type Row = Record<string, unknown>;

const INSERT_SQL: Record<Table, string> = {
  menu_items: `INSERT INTO menu_items (name, description, category, base_price_cents, available, created_at)
    VALUES (@name, @description, @category, @base_price_cents, @available, @created_at)`,
  sizes: 'INSERT INTO sizes (name, price_multiplier) VALUES (@name, @price_multiplier)',
  crusts: 'INSERT INTO crusts (name, price_delta_cents) VALUES (@name, @price_delta_cents)',
  toppings:
    'INSERT INTO toppings (name, price_cents, available) VALUES (@name, @price_cents, @available)',
  orders: `INSERT INTO orders (phone_number, status, total_cents, notes, created_at, updated_at)
    VALUES (@phone_number, @status, @total_cents, @notes, @created_at, @updated_at)`,
  order_items: `INSERT INTO order_items (order_id, menu_item_id, size_id, crust_id, quantity, unit_price_cents)
    VALUES (@order_id, @menu_item_id, @size_id, @crust_id, @quantity, @unit_price_cents)`,
  order_item_toppings: `INSERT INTO order_item_toppings (order_item_id, topping_id, price_cents)
    VALUES (@order_item_id, @topping_id, @price_cents)`,
  order_status_events: `INSERT INTO order_status_events (order_id, from_status, to_status, changed_at)
    VALUES (@order_id, @from_status, @to_status, @changed_at)`,
};

let rowsCreated = 0;

/** A valid row for each table. References point at the id 1 rows. */
const VALID_ROW: Record<Table, () => Row> = {
  menu_items: () => ({
    name: `Pizza ${++rowsCreated}`,
    description: 'Tomato sauce and mozzarella',
    category: 'Classic',
    base_price_cents: 1099,
    available: 1,
    created_at: NOW,
  }),
  sizes: () => ({ name: `Size ${++rowsCreated}`, price_multiplier: 1.25 }),
  crusts: () => ({ name: `Crust ${++rowsCreated}`, price_delta_cents: 200 }),
  toppings: () => ({ name: `Topping ${++rowsCreated}`, price_cents: 150, available: 1 }),
  orders: () => ({
    phone_number: '+12125550142',
    status: 'placed',
    total_cents: 2748,
    notes: '',
    created_at: NOW,
    updated_at: NOW,
  }),
  order_items: () => ({
    order_id: 1,
    menu_item_id: 1,
    size_id: 1,
    crust_id: 1,
    quantity: 2,
    unit_price_cents: 1374,
  }),
  order_item_toppings: () => ({ order_item_id: 1, topping_id: 1, price_cents: 150 }),
  order_status_events: () => ({
    order_id: 1,
    from_status: null,
    to_status: 'placed',
    changed_at: NOW,
  }),
};

function insert(db: Db, table: Table, overrides: Row = {}): void {
  db.prepare(INSERT_SQL[table]).run({ ...VALID_ROW[table](), ...overrides });
}

/** Inserts a valid row with `overrides` and returns the SQLite error code, if any. */
function insertError(db: Db, table: Table, overrides: Row): string | undefined {
  try {
    insert(db, table, overrides);
    return undefined;
  } catch (error) {
    if (error instanceof Database.SqliteError) {
      return error.code;
    }
    throw error;
  }
}

describe('0001_initial.sql', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(IN_MEMORY);
    migrate(db, INITIAL_MIGRATION);
    for (const table of REFERENCED_TABLES) {
      insert(db, table);
    }
  });

  afterEach(() => {
    db.close();
  });

  it('creates the eight domain tables', () => {
    const tables = db
      .prepare<[], string>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .pluck()
      .all();

    expect(tables).toEqual([...DOMAIN_TABLES, 'schema_migrations'].toSorted());
  });

  it.each([
    ['menu_items', 'base_price_cents'],
    ['crusts', 'price_delta_cents'],
    ['toppings', 'price_cents'],
    ['orders', 'total_cents'],
    ['order_items', 'unit_price_cents'],
    ['order_item_toppings', 'price_cents'],
  ] as const)('stores %s.%s as whole, non-negative cents', (table, column) => {
    expect(insertError(db, table, { [column]: 1373.75 })).toBe('SQLITE_CONSTRAINT_DATATYPE');
    expect(insertError(db, table, { [column]: -1 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertError(db, table, { [column]: 0 })).toBeUndefined();
  });

  it.each(['menu_items', 'toppings'] as const)('stores %s.available as 0 or 1', (table) => {
    expect(insertError(db, table, { available: 2 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertError(db, table, { available: -1 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertError(db, table, { available: 0 })).toBeUndefined();
    expect(insertError(db, table, { available: 1 })).toBeUndefined();
  });

  it.each(CATALOG_TABLES)('keeps %s names unique regardless of case', (table) => {
    insert(db, table, { name: 'House Special' });

    expect(insertError(db, table, { name: 'HOUSE SPECIAL' })).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect(insertError(db, table, { name: 'house special' })).toBe('SQLITE_CONSTRAINT_UNIQUE');
  });

  it.each(CATALOG_TABLES)('rejects a blank %s name', (table) => {
    expect(insertError(db, table, { name: '' })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertError(db, table, { name: '   ' })).toBe('SQLITE_CONSTRAINT_CHECK');
  });

  it.each(ORDER_STATUSES)('accepts the order status %s', (status) => {
    for (const [table, column] of STATUS_COLUMNS) {
      expect(insertError(db, table, { [column]: status })).toBeUndefined();
    }
  });

  it.each(['PLACED', 'shipped', ''])('rejects the order status %j', (status) => {
    for (const [table, column] of STATUS_COLUMNS) {
      expect(insertError(db, table, { [column]: status })).toBe('SQLITE_CONSTRAINT_CHECK');
    }
  });

  it('accepts a NULL from_status on any event, but never a NULL to_status', () => {
    // The schema does not limit NULL from_status to an order's first event.
    // recordInitialStatus in server/src/services/order-status.ts enforces that.
    const event = 'order_status_events';

    expect(insertError(db, event, { from_status: null })).toBeUndefined();
    expect(insertError(db, event, { to_status: null })).toBe('SQLITE_CONSTRAINT_NOTNULL');
  });

  it('defaults new orders to placed with empty notes, and catalog rows to available', () => {
    const orderId = db
      .prepare(
        `INSERT INTO orders (phone_number, total_cents, created_at, updated_at)
         VALUES ('+12125550142', 0, @now, @now)`,
      )
      .run({ now: NOW }).lastInsertRowid;
    const toppingId = db
      .prepare("INSERT INTO toppings (name, price_cents) VALUES ('Basil', 75)")
      .run().lastInsertRowid;
    const order = db.prepare('SELECT status, notes FROM orders WHERE id = ?').get(orderId);
    const topping = db.prepare('SELECT available FROM toppings WHERE id = ?').get(toppingId);

    expect(order).toEqual({ status: 'placed', notes: '' });
    expect(topping).toEqual({ available: 1 });
  });

  it('requires a whole order item quantity of at least 1', () => {
    expect(insertError(db, 'order_items', { quantity: 0 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertError(db, 'order_items', { quantity: 1.5 })).toBe('SQLITE_CONSTRAINT_DATATYPE');
    expect(insertError(db, 'order_items', { quantity: 1 })).toBeUndefined();
  });

  it('requires a positive size multiplier', () => {
    expect(insertError(db, 'sizes', { price_multiplier: 0 })).toBe('SQLITE_CONSTRAINT_CHECK');
    expect(insertError(db, 'sizes', { price_multiplier: 1.5 })).toBeUndefined();
  });

  it.each([
    ['order_items', 'order_id'],
    ['order_items', 'menu_item_id'],
    ['order_items', 'size_id'],
    ['order_items', 'crust_id'],
    ['order_item_toppings', 'order_item_id'],
    ['order_item_toppings', 'topping_id'],
    ['order_status_events', 'order_id'],
  ] as const)('rejects %s.%s pointing at a missing row', (table, column) => {
    expect(insertError(db, table, { [column]: 999 })).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
  });

  it('declares every foreign key ON DELETE RESTRICT', () => {
    const foreignKeys = DOMAIN_TABLES.flatMap((table) =>
      db
        .prepare<[string], { table: string; from: string; on_delete: string }>(
          'SELECT "table", "from", on_delete FROM pragma_foreign_key_list(?)',
        )
        .all(table)
        .map((key) => `${table}.${key.from} -> ${key.table} ${key.on_delete}`),
    );

    expect(foreignKeys.toSorted()).toEqual([
      'order_item_toppings.order_item_id -> order_items RESTRICT',
      'order_item_toppings.topping_id -> toppings RESTRICT',
      'order_items.crust_id -> crusts RESTRICT',
      'order_items.menu_item_id -> menu_items RESTRICT',
      'order_items.order_id -> orders RESTRICT',
      'order_items.size_id -> sizes RESTRICT',
      'order_status_events.order_id -> orders RESTRICT',
    ]);
  });

  it.each([
    'DELETE FROM menu_items WHERE id = 1',
    'DELETE FROM sizes WHERE id = 1',
    'DELETE FROM crusts WHERE id = 1',
    'DELETE FROM toppings WHERE id = 1',
    'DELETE FROM orders WHERE id = 1',
    'DELETE FROM order_items WHERE id = 1',
  ])('refuses %s while an order still references the row', (sql) => {
    insert(db, 'order_item_toppings');
    insert(db, 'order_status_events');

    // SQLite enforces RESTRICT through its trigger machinery, so the error code
    // is SQLITE_CONSTRAINT_TRIGGER rather than SQLITE_CONSTRAINT_FOREIGNKEY.
    expect(() => db.prepare(sql).run()).toThrow('FOREIGN KEY constraint failed');
  });

  it('indexes orders by phone number and by status, each followed by created_at', () => {
    const indexedColumns = db
      .prepare<[string], string>('SELECT name FROM pragma_index_list(?)')
      .pluck()
      .all('orders')
      .map((index) =>
        db
          .prepare<[string], string>('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
          .pluck()
          .all(index),
      );

    expect(indexedColumns).toEqual(
      expect.arrayContaining([
        ['phone_number', 'created_at'],
        ['status', 'created_at'],
      ]),
    );
  });
});
