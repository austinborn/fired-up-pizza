// The order status state machine (ADR 0004). This file holds the only copy of
// the transition table (rule 3). server/src/services/order-status.ts enforces
// it, and the client uses it only to decide what to show, such as which
// buttons an order card offers.

import type { OrderStatus } from './domain';

/**
 * The transition table (ADR 0004 rule 2), one row per status. `next` is the
 * step forward along placed -> preparing -> ready -> delivered, or null where
 * the path ends. `cancellable` allows the move to cancelled. Every other move
 * is illegal: backtracking, skipping a step, leaving a terminal status, and
 * "moving" to the current status.
 */
const TRANSITIONS = {
  placed: { next: 'preparing', cancellable: true },
  preparing: { next: 'ready', cancellable: true },
  ready: { next: 'delivered', cancellable: false },
  delivered: { next: null, cancellable: false },
  cancelled: { next: null, cancellable: false },
} as const satisfies Record<OrderStatus, { next: OrderStatus | null; cancellable: boolean }>;

/** A status an order reaches by a step forward: preparing, ready, or delivered. */
export type NextOrderStatus = NonNullable<(typeof TRANSITIONS)[OrderStatus]['next']>;

/**
 * The statuses that are not terminal, in path order. These are the orders the
 * kitchen still has to act on, which the staff queue shows.
 */
export const LIVE_ORDER_STATUSES = [
  'placed',
  'preparing',
  'ready',
] as const satisfies readonly OrderStatus[];

export type LiveOrderStatus = (typeof LIVE_ORDER_STATUSES)[number];

/**
 * Labels for the staff button that moves an order one step forward, keyed by
 * the status the step leads to. Look one up with `nextStatus(order.status)`
 * once that is not null.
 */
export const NEXT_STEP_LABELS: Readonly<Record<NextOrderStatus, string>> = {
  preparing: 'Start preparing',
  ready: 'Mark ready',
  delivered: 'Mark delivered',
};

/** `details` of a 409 ILLEGAL_STATUS_TRANSITION error response (ADR 0004 rule 6). */
export interface IllegalStatusTransitionDetails {
  /** The status the order has now. */
  currentStatus: OrderStatus;
  /** The status the request asked for. */
  requestedStatus: OrderStatus;
}

/** Whether an order in status `from` may move to status `to` (ADR 0004 rule 2). */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const { next, cancellable } = TRANSITIONS[from];
  return to === next || (cancellable && to === 'cancelled');
}

/** The status one step forward, or null for a terminal status. Cancelling is never a step forward. */
export function nextStatus(status: OrderStatus): NextOrderStatus | null {
  return TRANSITIONS[status].next;
}

/** Whether an order in this status can still be cancelled: only placed and preparing. */
export function isCancellable(status: OrderStatus): boolean {
  return TRANSITIONS[status].cancellable;
}

/** Whether an order in this status can never change again: delivered and cancelled (ADR 0004 rule 1). */
export function isTerminal(status: OrderStatus): boolean {
  const { next, cancellable } = TRANSITIONS[status];
  return next === null && !cancellable;
}
