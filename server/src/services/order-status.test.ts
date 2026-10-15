import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDER_STATUSES, type OrderStatus } from '@fired-up-pizza/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/connection';
import { AppError } from '../http/errors';
import {
  getOrderStatus,
  insertOrderStatusEvent,
  listOrderStatusEvents,
} from '../repositories/order-status';
import { createTestDatabase } from '../test/database';
import { recordInitialStatus, transitionOrderStatus } from './order-status';

// The repository runs for real. getOrderStatus and insertOrderStatusEvent are
// wrapped so that single tests can stage a lost race or a failed event insert.
// vi.resetAllMocks() restores the real behavior after each test.
vi.mock(import('../repositories/order-status'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getOrderStatus: vi.fn(actual.getOrderStatus),
    insertOrderStatusEvent: vi.fn(actual.insertOrderStatusEvent),
  };
});

const PLACED_AT = '2026-10-14T23:20:00.000Z';
const CHANGED_AT = '2026-10-14T23:31:00.000Z';

// ADR 0004 rule 2, restated here instead of read from shared/src/order-status.ts.
const LEGAL_TRANSITIONS: readonly (readonly [OrderStatus, OrderStatus])[] = [
  ['placed', 'preparing'],
  ['preparing', 'ready'],
  ['ready', 'delivered'],
  ['placed', 'cancelled'],
  ['preparing', 'cancelled'],
];

const ILLEGAL_TRANSITIONS = ORDER_STATUSES.flatMap((from) =>
  ORDER_STATUSES.map((to) => [from, to] as const),
).filter(
  ([from, to]) =>
    !LEGAL_TRANSITIONS.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to),
);

/** The legal moves that take a new order to each status. */
const PATH_TO: Record<OrderStatus, readonly OrderStatus[]> = {
  placed: [],
  preparing: ['preparing'],
  ready: ['preparing', 'ready'],
  delivered: ['preparing', 'ready', 'delivered'],
  cancelled: ['cancelled'],
};

// Test setup only: until the orders repository exists (fup-oe9.5), these tests
// insert order rows themselves with this one fixed statement. Application SQL
// stays in repositories/ (ADR 0002 rule 5). The row starts as placed by the
// column default, and its status then changes only through the service.
function insertOrderRow(db: Db): number {
  return Number(
    db
      .prepare(
        `INSERT INTO orders (phone_number, total_cents, created_at, updated_at)
         VALUES ('+12125550142', 1374, ?, ?)`,
      )
      .run(PLACED_AT, PLACED_AT).lastInsertRowid,
  );
}

/** Places an order as ADR 0004 rule 4 requires: the row and its initial event in one transaction. */
function placeOrder(db: Db): number {
  return db.transaction(() => {
    const orderId = insertOrderRow(db);
    recordInitialStatus(db, orderId);
    return orderId;
  })();
}

/** A placed order moved along legal steps to `status`, with its full audit trail. */
function orderIn(db: Db, status: OrderStatus): number {
  const orderId = placeOrder(db);
  for (const step of PATH_TO[status]) {
    transitionOrderStatus(db, orderId, step);
  }
  return orderId;
}

/** Everything a status change writes: the order's status and timestamps, and its events. */
function snapshot(db: Db, orderId: number) {
  return { order: getOrderStatus(db, orderId), events: listOrderStatusEvents(db, [orderId]) };
}

/** Returns what `action` throws, or undefined. */
function errorFrom(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

let db: Db;

beforeEach(() => {
  db = createTestDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  db.close();
});

describe('transitionOrderStatus', () => {
  it('is checked against all 25 status pairs', () => {
    expect(LEGAL_TRANSITIONS.length + ILLEGAL_TRANSITIONS.length).toBe(25);
  });

  it.each(LEGAL_TRANSITIONS)(
    'moves %s -> %s: updates status and updated_at and records the event',
    (from, to) => {
      const orderId = orderIn(db, from);
      const eventsBefore = listOrderStatusEvents(db, [orderId]);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(CHANGED_AT));

      const event = transitionOrderStatus(db, orderId, to);

      expect(event).toEqual({
        id: expect.any(Number),
        orderId,
        fromStatus: from,
        toStatus: to,
        changedAt: CHANGED_AT,
      });
      expect(getOrderStatus(db, orderId)).toEqual({
        status: to,
        createdAt: PLACED_AT,
        updatedAt: CHANGED_AT,
      });
      expect(listOrderStatusEvents(db, [orderId])).toEqual([...eventsBefore, event]);
    },
  );

  it.each(ILLEGAL_TRANSITIONS)('rejects %s -> %s with a 409 and writes nothing', (from, to) => {
    const orderId = orderIn(db, from);
    const before = snapshot(db, orderId);

    const error = errorFrom(() => transitionOrderStatus(db, orderId, to));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ILLEGAL_STATUS_TRANSITION', status: 409 });
    expect((error as AppError).details).toEqual({ currentStatus: from, requestedStatus: to });
    expect(snapshot(db, orderId)).toEqual(before);
  });

  it('throws a 404 NOT_FOUND AppError for an unknown order', () => {
    const error = errorFrom(() => transitionOrderStatus(db, 999, 'preparing'));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404, details: undefined });
  });

  it('records one event per status the order enters, from placed to delivered', () => {
    const orderId = orderIn(db, 'delivered');

    const trail = listOrderStatusEvents(db, [orderId]).map(({ fromStatus, toStatus }) => [
      fromStatus,
      toStatus,
    ]);

    expect(trail).toEqual([
      [null, 'placed'],
      ['placed', 'preparing'],
      ['preparing', 'ready'],
      ['ready', 'delivered'],
    ]);
  });

  it.each([
    { scenario: 'the same advance', requested: 'preparing' },
    { scenario: 'a cancel', requested: 'cancelled' },
  ] as const)(
    'returns a 409 and writes nothing when $scenario loses a race to a concurrent advance',
    ({ requested }) => {
      const orderId = placeOrder(db);
      // Another staff member's "Start preparing" commits first. Inside one
      // IMMEDIATE transaction nothing can come between the read and the
      // update, so the race is staged by having this request's read return
      // the status from before that click, as a read outside the
      // transaction or another process could.
      const winner = transitionOrderStatus(db, orderId, 'preparing');
      const before = snapshot(db, orderId);
      vi.mocked(getOrderStatus).mockReturnValueOnce({
        status: 'placed',
        createdAt: PLACED_AT,
        updatedAt: PLACED_AT,
      });

      const error = errorFrom(() => transitionOrderStatus(db, orderId, requested));

      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'ILLEGAL_STATUS_TRANSITION', status: 409 });
      expect((error as AppError).details).toEqual({
        currentStatus: 'preparing',
        requestedStatus: requested,
      });
      expect(snapshot(db, orderId)).toEqual(before);
      expect(before.events.at(-1)).toEqual(winner);
    },
  );

  it('undoes the status update when the event cannot be written', () => {
    const orderId = placeOrder(db);
    const before = snapshot(db, orderId);
    vi.mocked(insertOrderStatusEvent).mockImplementationOnce(() => {
      throw new Error('disk I/O error');
    });

    expect(() => transitionOrderStatus(db, orderId, 'preparing')).toThrow('disk I/O error');
    expect(snapshot(db, orderId)).toEqual(before);
  });
});

describe('recordInitialStatus', () => {
  it("records placed with no from_status, stamped with the order's created_at", () => {
    const { orderId, event } = db.transaction(() => {
      const id = insertOrderRow(db);
      return { orderId: id, event: recordInitialStatus(db, id) };
    })();

    expect(event).toEqual({
      id: expect.any(Number),
      orderId,
      fromStatus: null,
      toStatus: 'placed',
      changedAt: PLACED_AT,
    });
    expect(listOrderStatusEvents(db, [orderId])).toEqual([event]);
  });

  it('rolls back with the transaction that inserts the order', () => {
    let orderId = 0;
    const placeThenFail = db.transaction(() => {
      orderId = insertOrderRow(db);
      recordInitialStatus(db, orderId);
      throw new Error('a later insert failed');
    });

    expect(placeThenFail).toThrow('a later insert failed');
    expect(getOrderStatus(db, orderId)).toBeUndefined();
    expect(listOrderStatusEvents(db, [orderId])).toEqual([]);
  });

  it('refuses to run outside a transaction', () => {
    const orderId = insertOrderRow(db);

    expect(() => recordInitialStatus(db, orderId)).toThrow(
      'call it inside the transaction that inserts the order',
    );
    expect(listOrderStatusEvents(db, [orderId])).toEqual([]);
  });

  it('refuses an unknown order', () => {
    expect(db.transaction(() => recordInitialStatus(db, 999))).toThrow('the order does not exist');
  });

  it('refuses an order that is not placed', () => {
    const orderId = orderIn(db, 'preparing');
    const events = listOrderStatusEvents(db, [orderId]);

    expect(db.transaction(() => recordInitialStatus(db, orderId))).toThrow(
      'the order is preparing, but new orders start as placed',
    );
    expect(listOrderStatusEvents(db, [orderId])).toEqual(events);
  });

  it('refuses a second initial event, which the schema alone would accept', () => {
    const orderId = placeOrder(db);
    const events = listOrderStatusEvents(db, [orderId]);

    expect(db.transaction(() => recordInitialStatus(db, orderId))).toThrow(
      'the order already has status events',
    );
    expect(listOrderStatusEvents(db, [orderId])).toEqual(events);
  });

  it('is not an AppError, so a misuse surfaces as a 500 rather than a client error', () => {
    const error = errorFrom(() => recordInitialStatus(db, insertOrderRow(db)));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
  });
});

describe('orders.status write boundary (ADR 0004 rule 4)', () => {
  const srcDir = fileURLToPath(new URL('..', import.meta.url));

  const thisFile = path.relative(srcDir, fileURLToPath(import.meta.url));

  /**
   * Every module, test, and migration under server/src, relative to it. Tests
   * are scanned too, because they must not write orders.status either: they
   * arrange a status through the service. This file is skipped because it holds
   * the detectors' sample SQL.
   */
  function sourceFiles(): string[] {
    return fs
      .readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(?:ts|sql)$/.test(file) && file !== thisFile)
      .sort();
  }

  // `orders` as a table name: optionally schema-qualified or quoted, never order_items.
  const ORDERS = String.raw`(?:["\x60[]?\w+["\x60\]]?\s*\.\s*)?["\x60[]?orders(?!\w)["\x60\]]?`;
  // The SET clause runs to WHERE, RETURNING, or the end of the statement.
  const SET_CLAUSE = String.raw`SET\b([\s\S]*?)(?=\bWHERE\b|\bRETURNING\b|;|$)`;
  // UPDATE [OR <conflict>] orders [[AS] alias] [INDEXED BY <index> | NOT INDEXED] SET ...
  const UPDATE_ORDERS = new RegExp(
    String.raw`\bUPDATE\s+(?:OR\s+\w+\s+)?${ORDERS}\s+(?:(?:AS\s+)?\w+\s+)?(?:INDEXED\s+BY\s+\w+\s+|NOT\s+INDEXED\s+)?${SET_CLAUSE}`,
    'gi',
  );
  // INSERT INTO orders ... ON CONFLICT ... DO UPDATE SET ...
  const UPSERT_ORDERS = new RegExp(
    String.raw`\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+${ORDERS}[^;]*?\bDO\s+UPDATE\s+${SET_CLAUSE}`,
    'gi',
  );
  // REPLACE INTO orders and INSERT OR REPLACE INTO orders rewrite whole rows, status included.
  const REPLACE_ORDERS = new RegExp(String.raw`\bREPLACE\s+INTO\s+${ORDERS}`, 'gi');
  // `status = ...` as one assignment, or `status` inside a `(a, b) = (...)` column list.
  const ASSIGNS_STATUS = /(?:^|,)\s*["`[]?status["`\]]?\s*=|\([^()]*\bstatus\b[^()]*\)\s*=/i;

  /** The SQL statements in `source` that write orders.status. */
  function findOrderStatusWrites(source: string): string[] {
    const updates = [...source.matchAll(UPDATE_ORDERS), ...source.matchAll(UPSERT_ORDERS)]
      .filter(([, setClause = '']) => ASSIGNS_STATUS.test(setClause))
      .map(([statement]) => statement);
    const replaces = [...source.matchAll(REPLACE_ORDERS)].map(([statement]) => statement);
    return [...updates, ...replaces];
  }

  const REPOSITORY_MODULE = path.join(srcDir, 'repositories', 'order-status');
  const REPOSITORY_WRITES = /\b(?:updateOrderStatus|insertOrderStatusEvent)\b/;

  /** Whether the module at `file` (relative to server/src) imports the repository and uses one of its writes. */
  function usesRepositoryWrites(file: string, source: string): boolean {
    const importsRepository = [
      ...source.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g),
    ].some(
      ([, specifier = '']) =>
        path.resolve(srcDir, path.dirname(file), specifier).replace(/\.[jt]s$/, '') ===
        REPOSITORY_MODULE,
    );
    return importsRepository && REPOSITORY_WRITES.test(source);
  }

  it.each([
    'UPDATE orders SET status = ? WHERE id = ?',
    "update orders set status = 'cancelled'",
    'UPDATE orders SET updated_at = @now, status = @status WHERE id = @id',
    'UPDATE orders\n  SET\n    status = @toStatus\n  WHERE id = @orderId',
    'UPDATE "orders" SET "status" = ?',
    'UPDATE `orders` SET `status` = ?',
    'UPDATE main.orders SET status = ?',
    'UPDATE OR IGNORE orders SET status = ?',
    'UPDATE orders AS o SET status = ? WHERE o.id = ?',
    'UPDATE orders SET (status, updated_at) = (?, ?) WHERE id = ?',
    "UPDATE orders SET notes = 'Ring twice', status = 'ready'",
    'INSERT INTO orders (id, status) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET status = excluded.status',
    'INSERT OR REPLACE INTO orders (id, status) VALUES (?, ?)',
    'REPLACE INTO orders (id, status) VALUES (?, ?)',
  ])('detects %j as a write to orders.status', (sql) => {
    expect(findOrderStatusWrites(sql)).toHaveLength(1);
  });

  it.each([
    'SELECT status FROM orders WHERE id = ?',
    "INSERT INTO orders (phone_number, status) VALUES (?, 'placed')",
    'UPDATE orders SET notes = ? WHERE id = ? AND status = ?',
    'UPDATE orders SET status_note = ? WHERE id = ?',
    'UPDATE order_items SET quantity = ? WHERE order_id = ?',
    "UPDATE orders_archive SET status = 'x'",
    'INSERT INTO order_status_events (order_id, from_status, to_status) VALUES (?, ?, ?)',
  ])('does not mistake %j for a write to orders.status', (sql) => {
    expect(findOrderStatusWrites(sql)).toEqual([]);
  });

  it('finds orders.status written only in server/src/repositories/order-status.ts', () => {
    const writers = sourceFiles().filter(
      (file) => findOrderStatusWrites(fs.readFileSync(path.join(srcDir, file), 'utf8')).length > 0,
    );

    expect(writers).toEqual([path.join('repositories', 'order-status.ts')]);
  });

  it.each([
    {
      file: path.join('routes', 'staff', 'orders.ts'),
      source: "import { updateOrderStatus } from '../../repositories/order-status';",
      uses: true,
    },
    {
      file: path.join('repositories', 'orders.ts'),
      source: "import { insertOrderStatusEvent } from './order-status';",
      uses: true,
    },
    {
      file: path.join('routes', 'staff', 'orders.ts'),
      source: "const { updateOrderStatus } = await import('../../repositories/order-status');",
      uses: true,
    },
    {
      file: path.join('services', 'index.ts'),
      source: "export { insertOrderStatusEvent } from '../repositories/order-status';",
      uses: true,
    },
    {
      file: path.join('repositories', 'orders.ts'),
      source: "import { listOrderStatusEvents } from './order-status';",
      uses: false,
    },
    {
      file: path.join('services', 'orders.ts'),
      source: "import { recordInitialStatus } from './order-status';",
      uses: false,
    },
    {
      file: path.join('routes', 'staff', 'orders.ts'),
      source: "import { transitionOrderStatus } from '../../services/order-status';",
      uses: false,
    },
  ])(
    'judges $file with $source as using the repository writes: $uses',
    ({ file, source, uses }) => {
      expect(usesRepositoryWrites(file, source)).toBe(uses);
    },
  );

  it("finds the repository writes used only by the service and the repository's own test", () => {
    const callers = sourceFiles().filter((file) =>
      usesRepositoryWrites(file, fs.readFileSync(path.join(srcDir, file), 'utf8')),
    );

    expect(callers).toEqual([
      path.join('repositories', 'order-status.test.ts'),
      path.join('services', 'order-status.ts'),
    ]);
  });
});
