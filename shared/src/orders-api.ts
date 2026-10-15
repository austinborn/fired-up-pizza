// Customer orders API (ADR 0006): request and response types shared by
// server/src/routes/orders.ts and the client's checkout, confirmation, and
// tracking pages. The staff order endpoints return OrderDetails too.
//
//   POST /api/orders   PlaceOrderRequest -> 201 OrderDetails
//
// A request names catalog rows by id and never carries a price. The server
// strips any price fields, prices every item from the current catalog rows, and
// stores those prices with the order (ADR 0003 rules 3 and 4). OrderDetails
// takes every money value from those stored snapshots, so an order's prices and
// total never change once it is placed. Display names are not snapshotted: an
// order shows the current name of each menu item, size, crust, and topping
// (ADR 0003, Consequences).
//
// Errors use the ADR 0006 shape, and a failed request stores nothing:
// - 400 VALIDATION_ERROR for a body that does not fit PlaceOrderRequest, no
//   items or more than MAX_ITEMS_PER_ORDER, notes longer than
//   MAX_ORDER_NOTES_LENGTH, or an item that breaks the ordering limits in
//   @fired-up-pizza/shared/pricing (quantity, topping count, a topping listed
//   twice). The server trims notes before checking their length, and lengths
//   are JavaScript string lengths, so a form can run the same check.
// - 400 INVALID_PHONE_NUMBER for a phone number that
//   @fired-up-pizza/shared/phone does not accept (ADR 0005 rule 3).
// - 422 ITEM_UNAVAILABLE for a menu item or topping that is hidden or does not
//   exist, or a size or crust that does not exist.
// VALIDATION_ERROR and ITEM_UNAVAILABLE list their problems in
// `details.issues: [{ path, message }]`, with paths into the request body such
// as `items.0.toppingIds.1`.

import type { Order, OrderItem, OrderItemTopping, OrderStatusEvent } from './domain';

/** The most lines one order can have. Each line holds up to MAX_QUANTITY_PER_ITEM pizzas. */
export const MAX_ITEMS_PER_ORDER = 25;

/** The longest order note, after trimming. Notes are optional. */
export const MAX_ORDER_NOTES_LENGTH = 500;

/** One line of a PlaceOrderRequest: catalog ids and a quantity, never a price (ADR 0003 rule 3). */
export interface PlaceOrderItem extends Pick<
  OrderItem,
  'menuItemId' | 'sizeId' | 'crustId' | 'quantity'
> {
  /** Distinct topping ids, in the order the customer chose them. */
  toppingIds: number[];
}

/** POST /api/orders. */
export interface PlaceOrderRequest {
  /** As the customer typed it. The server checks and normalizes it (ADR 0005). */
  phoneNumber: string;
  /** For the kitchen. Omitted means no notes. */
  notes?: string;
  /** From 1 to MAX_ITEMS_PER_ORDER lines. */
  items: PlaceOrderItem[];
}

/** A topping on an order line: the price it was charged and its current name. */
export interface OrderDetailsTopping extends Omit<OrderItemTopping, 'orderItemId'> {
  toppingName: string;
}

/** An order line: its stored unit price, and the current names of what it was made with. */
export interface OrderDetailsItem extends Omit<OrderItem, 'orderId'> {
  menuItemName: string;
  sizeName: string;
  crustName: string;
  /** In the order the customer chose them. */
  toppings: OrderDetailsTopping[];
}

/** One entry in an order's status history (ADR 0004). */
export type OrderDetailsStatusEvent = Omit<OrderStatusEvent, 'orderId'>;

/**
 * An order with its lines and status history: what POST /api/orders returns.
 * Nested rows leave out the id of the row they belong to.
 */
export interface OrderDetails extends Order {
  /** In the order they were placed. */
  items: OrderDetailsItem[];
  /** Oldest first, starting with the `placed` event whose `fromStatus` is null. */
  statusEvents: OrderDetailsStatusEvent[];
}
