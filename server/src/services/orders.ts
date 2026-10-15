// The place-order use case. The route has already checked the request's shape
// and resolved the customer through server/src/identity/ (ADR 0005 rule 2).
// In one transaction (ADR 0002 rule 8), this service:
//   1. prices every item from the current catalog rows (ADR 0003 rule 3)
//   2. inserts the order, its lines, and their toppings, with those prices as
//      snapshots (ADR 0003 rule 4)
//   3. records the initial status event through the order status service
//      (ADR 0004 rule 4)
//   4. reads the order back, so the caller gets the stored snapshots
// Anything that throws rolls all of it back, so a failed order stores nothing.

import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import type { Db } from '../db/connection';
import type { CustomerIdentity } from '../identity';
import { getOrderDetails, insertOrder } from '../repositories/orders';
import { recordInitialStatus } from './order-status';
import { priceOrderItems, type OrderItemSelection } from './pricing';

export interface PlaceOrderInput {
  /** Who is ordering, as resolveCustomerIdentity returned it. */
  customer: CustomerIdentity;
  /** For the kitchen, already trimmed and length-checked by the route. Empty for none. */
  notes: string;
  /** Catalog ids and quantities, never prices (ADR 0003 rule 3). */
  items: readonly OrderItemSelection[];
}

/**
 * Places an order and returns it as stored, so every money value in the result
 * is a snapshot. Throws the pricing service's AppError VALIDATION_ERROR (400)
 * for an item that breaks the ordering limits, or ITEM_UNAVAILABLE (422) for
 * one that cannot be ordered. Nothing is written when it throws.
 */
export function placeOrder(db: Db, { customer, notes, items }: PlaceOrderInput): OrderDetails {
  const place = db.transaction((): OrderDetails => {
    const priced = priceOrderItems(db, items);
    const orderId = insertOrder(db, {
      phoneNumber: customer.phoneNumber,
      totalCents: priced.totalCents,
      notes,
      createdAt: new Date().toISOString(),
      items: priced.items,
    });
    recordInitialStatus(db, orderId);
    const order = getOrderDetails(db, orderId);
    if (order === undefined) {
      throw new Error(`Order ${orderId} is missing from the transaction that inserted it`);
    }
    return order;
  });
  // IMMEDIATE takes the write lock before pricing, so no other connection can
  // change the catalog rows between pricing the items and storing the order.
  return place.immediate();
}
