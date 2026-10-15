import type { OrderDetails, PlaceOrderRequest } from '@fired-up-pizza/shared/orders-api';
import { postJson, type RequestOptions } from './http';

// Customer orders (ADR 0006 rule 2) for checkout and order tracking. The
// request and response types, and the errors the server answers with, are
// documented in @fired-up-pizza/shared/orders-api.

/**
 * Places an order with POST /api/orders. The request names catalog rows by id
 * and never carries a price (ADR 0003 rule 3). Resolves with the order as the
 * server stored it: its prices are the server's snapshots, which the
 * confirmation shows instead of the cart's estimates (ADR 0003 rule 5).
 *
 * Rejects with an ApiError. VALIDATION_ERROR and ITEM_UNAVAILABLE list their
 * problems in `details.issues` (read them with apiErrorIssues from
 * @fired-up-pizza/shared), and INVALID_PHONE_NUMBER rejects the phone number.
 */
export function placeOrder(
  request: PlaceOrderRequest,
  options?: RequestOptions,
): Promise<OrderDetails> {
  return postJson<OrderDetails>('/api/orders', request, options);
}
