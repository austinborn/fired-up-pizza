// Staff order queue API (ADR 0006): request types shared by
// server/src/routes/staff/orders.ts and the staff order queue page. Both
// endpoints answer with OrderDetails from @fired-up-pizza/shared/orders-api,
// so they show every customer's phone number, which only staff endpoints may
// do (ADR 0005 rule 4).
//
//   GET   /api/staff/orders?statuses=placed,ready   -> OrderDetails[], oldest first
//   PATCH /api/staff/orders/:id/status   UpdateOrderStatusRequest -> OrderDetails
//
// The GET lists every order in the requested statuses, oldest createdAt first,
// so the kitchen works in the order customers ordered. Without `statuses` it
// lists the live orders, LIVE_ORDER_STATUSES in @fired-up-pizza/shared/order-status.
// The list is never cut short: sorted oldest first, a cap would hide the newest
// orders, the ones the kitchen has not seen yet.
//
// The PATCH moves one order through the server's single transition service
// (ADR 0004 rule 4). Only the moves in @fired-up-pizza/shared/order-status are
// allowed, and each one is recorded as a status event. The response is the
// order with its new status and updatedAt, and the new event at the end of
// statusEvents.
//
// Errors use the ADR 0006 shape:
// - 400 VALIDATION_ERROR for a `statuses` value that is not a comma-separated
//   list of ORDER_STATUSES values, or that is sent more than once; an order id
//   that is not a positive whole number; or a body whose `status` is not one of
//   ORDER_STATUSES. `details.issues: [{ path, message }]` lists the problems,
//   with paths such as `statuses.1`, `id`, or `status`.
// - 404 NOT_FOUND for an order that does not exist.
// - 409 ILLEGAL_STATUS_TRANSITION, with IllegalStatusTransitionDetails
//   `{ currentStatus, requestedStatus }` as `details`, for a move the
//   transition table forbids: backtracking, skipping a step, cancelling a ready
//   order, changing a delivered or cancelled order, or "moving" to the current
//   status. It is also the answer when another request changed the order first,
//   such as a second click on the same button. The order is left as it was; the
//   page refreshes to show its current status (ADR 0007 rule 5).

import type { Order, OrderStatus } from './domain';

/**
 * GET /api/staff/orders. `statuses` travels as one comma-separated query
 * parameter, e.g. `?statuses=placed,ready`; a comma encoded as `%2C`, as
 * URLSearchParams writes it, works too.
 */
export interface StaffOrdersQuery {
  /** Only orders in these statuses: at least one. Omitted means LIVE_ORDER_STATUSES. */
  statuses?: readonly OrderStatus[];
}

/** PATCH /api/staff/orders/:id/status: the status to move the order to. */
export type UpdateOrderStatusRequest = Pick<Order, 'status'>;
