// Rules for the staff order queue page (/staff/orders) that need no React:
// which section shows each live order, and how an order saved by a status
// change shows before the next poll catches up.

import type { OrderStatus } from '@fired-up-pizza/shared';
import { LIVE_ORDER_STATUSES, type LiveOrderStatus } from '@fired-up-pizza/shared/order-status';
import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';

/**
 * A status change the page sent for one order, keyed by order id: in flight,
 * or failed for a reason other than a 409, which the card shows with a retry.
 * `from` is the status the order had when the change was sent; once the order
 * is in any other status, the failure no longer applies.
 */
export type OrderAction =
  | { state: 'pending'; to: OrderStatus }
  | { state: 'failed'; from: OrderStatus; to: OrderStatus; error: unknown };

/** Each section's heading, and what it says when it has no orders. */
export const ORDER_QUEUE_SECTIONS: Readonly<
  Record<LiveOrderStatus, { title: string; emptyText: string }>
> = {
  placed: { title: 'Placed', emptyText: 'No new orders.' },
  preparing: { title: 'Preparing', emptyText: 'Nothing in the kitchen.' },
  ready: { title: 'Ready', emptyText: 'Nothing waiting to go out.' },
};

export interface OrderQueueGroup {
  status: LiveOrderStatus;
  orders: OrderDetails[];
}

/**
 * One group per live status, in path order (placed, preparing, ready), each
 * with its orders in list order. GET /api/staff/orders lists orders oldest
 * first, so each group is oldest first too. An order in any other status,
 * such as one just delivered or cancelled, is in no group.
 */
export function groupLiveOrders(orders: readonly OrderDetails[]): OrderQueueGroup[] {
  return LIVE_ORDER_STATUSES.map((status) => ({
    status,
    orders: orders.filter((order) => order.status === status),
  }));
}

/**
 * The list with each saved order in place of an older copy. A status change
 * answers with the order as it is now, and the page shows that copy at once,
 * before the queue reloads. A poll that was already running when the change
 * was saved can still return the order as it was; this keeps such a list from
 * moving the order back.
 *
 * Every status change adds one status event (ADR 0004 rule 4), so the copy
 * with more events is the newer one. A saved order that is no longer listed
 * stays out: it has left the live queue.
 */
export function withSavedOrders(
  list: readonly OrderDetails[],
  saved: readonly OrderDetails[],
): readonly OrderDetails[] {
  if (saved.length === 0) {
    return list;
  }
  const savedById = new Map(saved.map((order) => [order.id, order]));
  return list.map((listed) => {
    const savedCopy = savedById.get(listed.id);
    return savedCopy !== undefined && isNewer(savedCopy, listed) ? savedCopy : listed;
  });
}

/** The saved orders that `list` has not caught up with yet: the ones withSavedOrders still uses. */
export function savedOrdersAhead(
  saved: readonly OrderDetails[],
  list: readonly OrderDetails[],
): OrderDetails[] {
  const listedById = new Map(list.map((order) => [order.id, order]));
  return saved.filter((savedCopy) => {
    const listed = listedById.get(savedCopy.id);
    return listed !== undefined && isNewer(savedCopy, listed);
  });
}

function isNewer(order: OrderDetails, than: OrderDetails): boolean {
  return order.statusEvents.length > than.statusEvents.length;
}
