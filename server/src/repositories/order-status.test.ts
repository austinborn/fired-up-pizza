import type { OrderStatus } from '@fired-up-pizza/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection';
import { createTestDatabase } from '../test/database';
import {
  getOrderStatus,
  insertOrderStatusEvent,
  listOrderStatusEvents,
  updateOrderStatus,
} from './order-status';

const PLACED_AT = '2026-10-14T23:20:00.000Z';
const LATER = '2026-10-14T23:31:00.000Z';
const LATER_STILL = '2026-10-14T23:42:00.000Z';

/**
 * A new order, placed by the column default. Even in tests, its status then
 * changes only through updateOrderStatus (ADR 0004 rule 4).
 */
function insertOrder(db: Db): number {
  return Number(
    db
      .prepare(
        `INSERT INTO orders (phone_number, total_cents, notes, created_at, updated_at)
         VALUES ('+12125550142', 1374, 'Ring twice', ?, ?)`,
      )
      .run(PLACED_AT, PLACED_AT).lastInsertRowid,
  );
}

/** The whole orders row, to show which columns a write touched. */
function orderRow(db: Db, orderId: number): Record<string, unknown> | undefined {
  return db
    .prepare<[number], Record<string, unknown>>('SELECT * FROM orders WHERE id = ?')
    .get(orderId);
}

describe('order status repository', () => {
  let db: Db;

  beforeEach(() => {
    db = createTestDatabase();
  });

  afterEach(() => {
    db.close();
  });

  describe('getOrderStatus', () => {
    it("returns a new order's status and timestamps", () => {
      const orderId = insertOrder(db);

      expect(getOrderStatus(db, orderId)).toEqual({
        status: 'placed',
        createdAt: PLACED_AT,
        updatedAt: PLACED_AT,
      });
    });

    it('returns the current status and updated_at after a change', () => {
      const orderId = insertOrder(db);
      updateOrderStatus(db, {
        orderId,
        fromStatus: 'placed',
        toStatus: 'preparing',
        updatedAt: LATER,
      });

      expect(getOrderStatus(db, orderId)).toEqual({
        status: 'preparing',
        createdAt: PLACED_AT,
        updatedAt: LATER,
      });
    });

    it('returns undefined for an unknown order', () => {
      expect(getOrderStatus(db, 999)).toBeUndefined();
    });
  });

  describe('updateOrderStatus', () => {
    it('sets status and updated_at, and nothing else, while the status is as expected', () => {
      const orderId = insertOrder(db);
      const before = orderRow(db, orderId);

      const updated = updateOrderStatus(db, {
        orderId,
        fromStatus: 'placed',
        toStatus: 'preparing',
        updatedAt: LATER,
      });

      expect(updated).toBe(true);
      expect(orderRow(db, orderId)).toEqual({
        ...before,
        status: 'preparing',
        updated_at: LATER,
      });
    });

    it('changes nothing and returns false once the status has moved on', () => {
      // What a lost race looks like: this caller read placed, but another
      // request has made the order preparing since.
      const orderId = insertOrder(db);
      updateOrderStatus(db, {
        orderId,
        fromStatus: 'placed',
        toStatus: 'preparing',
        updatedAt: LATER,
      });
      const before = orderRow(db, orderId);

      const updated = updateOrderStatus(db, {
        orderId,
        fromStatus: 'placed',
        toStatus: 'cancelled',
        updatedAt: LATER_STILL,
      });

      expect(updated).toBe(false);
      expect(orderRow(db, orderId)).toEqual(before);
    });

    it('returns false for an unknown order', () => {
      expect(
        updateOrderStatus(db, {
          orderId: 999,
          fromStatus: 'placed',
          toStatus: 'preparing',
          updatedAt: LATER,
        }),
      ).toBe(false);
    });

    it('leaves other orders alone', () => {
      const orderId = insertOrder(db);
      const otherId = insertOrder(db);
      const other = orderRow(db, otherId);

      updateOrderStatus(db, {
        orderId,
        fromStatus: 'placed',
        toStatus: 'cancelled',
        updatedAt: LATER,
      });

      expect(orderRow(db, otherId)).toEqual(other);
    });
  });

  describe('insertOrderStatusEvent', () => {
    it('stores the event and returns it with its new id', () => {
      const orderId = insertOrder(db);

      const event = insertOrderStatusEvent(db, {
        orderId,
        fromStatus: 'placed',
        toStatus: 'preparing',
        changedAt: LATER,
      });

      expect(event).toEqual({
        id: expect.any(Number),
        orderId,
        fromStatus: 'placed',
        toStatus: 'preparing',
        changedAt: LATER,
      });
      expect(db.prepare('SELECT * FROM order_status_events WHERE id = ?').get(event.id)).toEqual({
        id: event.id,
        order_id: orderId,
        from_status: 'placed',
        to_status: 'preparing',
        changed_at: LATER,
      });
    });

    it('stores a missing from_status as NULL, as the initial event needs', () => {
      const orderId = insertOrder(db);

      const event = insertOrderStatusEvent(db, {
        orderId,
        fromStatus: null,
        toStatus: 'placed',
        changedAt: PLACED_AT,
      });

      expect(event.fromStatus).toBeNull();
      expect(listOrderStatusEvents(db, [orderId])).toEqual([event]);
    });

    it('rejects an event for an unknown order', () => {
      expect(() =>
        insertOrderStatusEvent(db, {
          orderId: 999,
          fromStatus: null,
          toStatus: 'placed',
          changedAt: PLACED_AT,
        }),
      ).toThrow('FOREIGN KEY constraint failed');
    });
  });

  describe('listOrderStatusEvents', () => {
    let first: number;
    let second: number;
    let third: number;

    beforeEach(() => {
      first = insertOrder(db);
      second = insertOrder(db);
      third = insertOrder(db);
      // Interleaved across orders, the way a busy kitchen records them. Each
      // step changes the status and then records it, as the service does.
      const trail: [number, OrderStatus | null, OrderStatus, string][] = [
        [first, null, 'placed', '2026-10-14T23:20:00.000Z'],
        [second, null, 'placed', '2026-10-14T23:21:00.000Z'],
        [first, 'placed', 'preparing', '2026-10-14T23:22:00.000Z'],
        [third, null, 'placed', '2026-10-14T23:23:00.000Z'],
        [second, 'placed', 'cancelled', '2026-10-14T23:24:00.000Z'],
        [first, 'preparing', 'ready', '2026-10-14T23:25:00.000Z'],
        [third, 'placed', 'preparing', '2026-10-14T23:26:00.000Z'],
      ];
      for (const [orderId, fromStatus, toStatus, changedAt] of trail) {
        if (fromStatus !== null) {
          updateOrderStatus(db, { orderId, fromStatus, toStatus, updatedAt: changedAt });
        }
        insertOrderStatusEvent(db, { orderId, fromStatus, toStatus, changedAt });
      }
    });

    /** The (orderId, from -> to) steps of a list of events, for compact comparisons. */
    function steps(orderIds: readonly number[]): string[] {
      return listOrderStatusEvents(db, orderIds).map(
        (event) => `${event.orderId}: ${event.fromStatus ?? 'new'} -> ${event.toStatus}`,
      );
    }

    it('returns nothing for no ids', () => {
      expect(listOrderStatusEvents(db, [])).toEqual([]);
    });

    it("returns each order's events in the order they were recorded, by ascending order id", () => {
      expect(steps([third, first])).toEqual([
        `${first}: new -> placed`,
        `${first}: placed -> preparing`,
        `${first}: preparing -> ready`,
        `${third}: new -> placed`,
        `${third}: placed -> preparing`,
      ]);
    });

    it('returns events as shared domain objects', () => {
      expect(listOrderStatusEvents(db, [second])).toEqual([
        {
          id: expect.any(Number),
          orderId: second,
          fromStatus: null,
          toStatus: 'placed',
          changedAt: '2026-10-14T23:21:00.000Z',
        },
        {
          id: expect.any(Number),
          orderId: second,
          fromStatus: 'placed',
          toStatus: 'cancelled',
          changedAt: '2026-10-14T23:24:00.000Z',
        },
      ]);
    });

    it('skips unknown ids and returns a repeated id once', () => {
      expect(steps([999, second, second])).toEqual([
        `${second}: new -> placed`,
        `${second}: placed -> cancelled`,
      ]);
    });

    it('returns nothing for an order without events', () => {
      const fresh = insertOrder(db);

      expect(listOrderStatusEvents(db, [fresh])).toEqual([]);
    });
  });
});
