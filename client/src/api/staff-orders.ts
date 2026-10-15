import { isOrderStatus } from '@fired-up-pizza/shared';
import type { IllegalStatusTransitionDetails } from '@fired-up-pizza/shared/order-status';
import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import type { UpdateOrderStatusRequest } from '@fired-up-pizza/shared/staff-orders-api';
import { ApiError, getJson, patchJson, type RequestOptions } from './http';

// The staff order queue (ADR 0006 rule 2) for /staff/orders. The request types
// and the error contract are in @fired-up-pizza/shared/staff-orders-api. Both
// endpoints answer with OrderDetails, phone numbers included, which only staff
// endpoints may send (ADR 0005 rule 4). The queue page polls getLiveOrders
// through usePolling (ADR 0007 rule 4), so pass the AbortSignal it provides.

/**
 * Every live order (placed, preparing, or ready), oldest first, with its lines
 * and status history. This is the endpoint's default list. It sends no
 * `statuses` filter: a filter that names delivered or cancelled orders returns
 * the whole order history, which a polled view must not fetch.
 */
export function getLiveOrders(options?: RequestOptions): Promise<OrderDetails[]> {
  return getJson<OrderDetails[]>('/api/staff/orders', options);
}

/**
 * Moves one order to `request.status` through the server's transition service
 * (ADR 0004 rule 4), and resolves with the order as it is now: its new status
 * and the new event at the end of its status history. A move the transition
 * table forbids, or one that another request made first, fails with a 409
 * ILLEGAL_STATUS_TRANSITION ApiError; see illegalTransition.
 */
export function changeOrderStatus(
  orderId: number,
  request: UpdateOrderStatusRequest,
  options?: RequestOptions,
): Promise<OrderDetails> {
  return patchJson<OrderDetails>(`/api/staff/orders/${orderId}/status`, request, options);
}

/**
 * The details of a failed changeOrderStatus that the server refused with 409
 * ILLEGAL_STATUS_TRANSITION (ADR 0004 rule 6): the order was not in the status
 * the page showed, because someone else moved it first or the page was out of
 * date, so the page should refresh (ADR 0007 rule 5). A field is left out when
 * the details do not hold a valid status for it. Null for any other failure.
 */
export function illegalTransition(error: unknown): Partial<IllegalStatusTransitionDetails> | null {
  if (!(error instanceof ApiError) || error.code !== 'ILLEGAL_STATUS_TRANSITION') {
    return null;
  }
  const details: unknown = error.details;
  const found: Partial<IllegalStatusTransitionDetails> = {};
  if (typeof details === 'object' && details !== null) {
    if ('currentStatus' in details && isOrderStatus(details.currentStatus)) {
      found.currentStatus = details.currentStatus;
    }
    if ('requestedStatus' in details && isOrderStatus(details.requestedStatus)) {
      found.requestedStatus = details.requestedStatus;
    }
  }
  return found;
}
