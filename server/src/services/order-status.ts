// The only code that changes orders.status (ADR 0004 rule 4). Every change is
// checked against the shared transition table and committed in one transaction
// together with its order_status_events row. The SQL lives in
// server/src/repositories/order-status.ts. A boundary test in
// order-status.test.ts fails if any other module writes orders.status.
//
// Staff routes call transitionOrderStatus. The place-order flow calls
// recordInitialStatus inside the transaction that inserts the order.

import type { OrderStatus, OrderStatusEvent } from '@fired-up-pizza/shared';
import {
  canTransition,
  type IllegalStatusTransitionDetails,
} from '@fired-up-pizza/shared/order-status';
import type { Db } from '../db/connection';
import { AppError } from '../http/errors';
import {
  getOrderStatus,
  insertOrderStatusEvent,
  listOrderStatusEvents,
  updateOrderStatus,
} from '../repositories/order-status';

/**
 * Moves an order to `toStatus` and returns the event that records the move
 * (ADR 0004 rules 2 and 4-6). In one transaction it reads the current status,
 * checks the move against the shared table, updates status and updated_at only
 * if the status is still the one it read, and inserts the event. The update and
 * the event share one timestamp.
 *
 * Throws AppError NOT_FOUND (404) for an unknown order. Throws
 * ILLEGAL_STATUS_TRANSITION (409) with details { currentStatus, requestedStatus }
 * when the table forbids the move, or when the conditional update changes no
 * row because another request changed the status first. Either way nothing is
 * written.
 */
export function transitionOrderStatus(
  db: Db,
  orderId: number,
  toStatus: OrderStatus,
): OrderStatusEvent {
  const transition = db.transaction((): OrderStatusEvent => {
    const fromStatus = readStatus(db, orderId);
    if (!canTransition(fromStatus, toStatus)) {
      throw illegalTransition(
        `Order ${orderId} cannot move from ${fromStatus} to ${toStatus}`,
        fromStatus,
        toStatus,
      );
    }
    const changedAt = new Date().toISOString();
    if (!updateOrderStatus(db, { orderId, fromStatus, toStatus, updatedAt: changedAt })) {
      const newStatus = readStatus(db, orderId);
      throw illegalTransition(
        `Order ${orderId} was changed to ${newStatus} by another request`,
        newStatus,
        toStatus,
      );
    }
    return insertOrderStatusEvent(db, { orderId, fromStatus, toStatus, changedAt });
  });
  // IMMEDIATE takes the write lock before the read, so another process cannot
  // change the order between the read and the update. If one did anyway, the
  // conditional update would catch it (ADR 0004 rule 5).
  return transition.immediate();
}

/**
 * Records a new order's first event: no from_status, to_status placed, stamped
 * with the order's created_at (ADR 0004 rule 4). Call it right after inserting
 * the order, inside the same transaction, so the order never exists without its
 * event. Returns the event.
 *
 * The schema accepts a NULL from_status on any event, so this function enforces
 * the rule itself. It throws a plain Error, which becomes a 500, unless it runs
 * inside a transaction and the order exists, is placed, and has no events yet.
 */
export function recordInitialStatus(db: Db, orderId: number): OrderStatusEvent {
  const refuse = (reason: string) =>
    new Error(`Cannot record the initial status of order ${orderId}: ${reason}`);
  if (!db.inTransaction) {
    throw refuse('call it inside the transaction that inserts the order');
  }
  const order = getOrderStatus(db, orderId);
  if (order === undefined) {
    throw refuse('the order does not exist');
  }
  if (order.status !== 'placed') {
    throw refuse(`the order is ${order.status}, but new orders start as placed`);
  }
  if (listOrderStatusEvents(db, [orderId]).length > 0) {
    throw refuse('the order already has status events');
  }
  return insertOrderStatusEvent(db, {
    orderId,
    fromStatus: null,
    toStatus: 'placed',
    changedAt: order.createdAt,
  });
}

/** The order's status, or AppError NOT_FOUND if there is no such order. */
function readStatus(db: Db, orderId: number): OrderStatus {
  const order = getOrderStatus(db, orderId);
  if (order === undefined) {
    throw new AppError('NOT_FOUND', `Order ${orderId} not found`);
  }
  return order.status;
}

function illegalTransition(
  message: string,
  currentStatus: OrderStatus,
  requestedStatus: OrderStatus,
): AppError {
  const details: IllegalStatusTransitionDetails = { currentStatus, requestedStatus };
  return new AppError('ILLEGAL_STATUS_TRANSITION', message, details);
}
