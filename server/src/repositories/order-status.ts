// All SQL for order status: orders.status and the order_status_events audit
// trail (ADR 0004 rule 4). The writes, updateOrderStatus and
// insertOrderStatusEvent, are called only by server/src/services/order-status.ts,
// inside its transactions. Anything may read. A boundary test in
// server/src/services/order-status.test.ts fails if another module writes
// orders.status or calls these writes.

import type { Order, OrderStatus, OrderStatusEvent } from '@fired-up-pizza/shared';
import type { Db } from '../db/connection';

/** One status change, applied only while the order is still `fromStatus`. */
export interface OrderStatusUpdate {
  orderId: number;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  /** The new orders.updated_at. */
  updatedAt: string;
}

/** An order_status_events row before the database assigns its id. */
export type NewOrderStatusEvent = Omit<OrderStatusEvent, 'id'>;

/** An order's current status and its timestamps. */
export type OrderStatusRecord = Pick<Order, 'status' | 'createdAt' | 'updatedAt'>;

/** The order's status record, or undefined if there is no such order. */
export function getOrderStatus(db: Db, orderId: number): OrderStatusRecord | undefined {
  return db
    .prepare<[number], OrderStatusRecord>(
      'SELECT status, created_at AS createdAt, updated_at AS updatedAt FROM orders WHERE id = ?',
    )
    .get(orderId);
}

/**
 * The conditional update behind every transition (ADR 0004 rule 5). It sets
 * status and updated_at only if the order's status is still `fromStatus`.
 * Returns false when no row changed: either the order does not exist, or
 * another request changed its status first.
 */
export function updateOrderStatus(db: Db, update: OrderStatusUpdate): boolean {
  const { changes } = db
    .prepare<OrderStatusUpdate>(
      `UPDATE orders SET status = @toStatus, updated_at = @updatedAt
       WHERE id = @orderId AND status = @fromStatus`,
    )
    .run(update);
  return changes === 1;
}

/** Appends one row to an order's audit trail and returns it with its new id. */
export function insertOrderStatusEvent(db: Db, event: NewOrderStatusEvent): OrderStatusEvent {
  const { orderId, fromStatus, toStatus, changedAt } = event;
  const { lastInsertRowid } = db
    .prepare<NewOrderStatusEvent>(
      `INSERT INTO order_status_events (order_id, from_status, to_status, changed_at)
       VALUES (@orderId, @fromStatus, @toStatus, @changedAt)`,
    )
    .run({ orderId, fromStatus, toStatus, changedAt });
  return { id: Number(lastInsertRowid), orderId, fromStatus, toStatus, changedAt };
}

/**
 * The audit trails of the given orders, grouped by order id (ascending) and in
 * the order the events were recorded. Unknown ids are skipped, and a repeated
 * id returns its events once. The ids are bound as one JSON array parameter, so
 * a single prepared statement serves any number of them without building SQL
 * (ADR 0002 rule 5).
 */
export function listOrderStatusEvents(db: Db, orderIds: readonly number[]): OrderStatusEvent[] {
  if (orderIds.length === 0) {
    return [];
  }
  return db
    .prepare<[string], OrderStatusEvent>(
      `SELECT id, order_id AS orderId, from_status AS fromStatus, to_status AS toStatus,
              changed_at AS changedAt
       FROM order_status_events
       WHERE order_id IN (SELECT value FROM json_each(?))
       ORDER BY order_id, id`,
    )
    .all(JSON.stringify(orderIds));
}
