import type { OrderStatus } from '@fired-up-pizza/shared';
import { nextStatus } from '@fired-up-pizza/shared/order-status';

/**
 * The path an order moves along: placed, preparing, ready, delivered. It is
 * read from the shared transition table (ADR 0004 rule 3), starting from
 * placed, where every order starts (rule 1).
 */
const STEPS: readonly OrderStatus[] = pathFrom('placed');

/** Each status as a customer reads it. */
const STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  placed: 'Placed',
  preparing: 'Preparing',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

type StepState = 'done' | 'current' | 'upcoming';

const LABEL_CLASSES: Readonly<Record<StepState, string>> = {
  done: 'text-stone-700',
  current: 'font-semibold text-stone-900',
  upcoming: 'text-stone-500',
};

/**
 * An order's status for its customer (order tracking). An order on the path
 * shows every step, with the steps it has reached filled in and the current
 * one marked as the current step. A cancelled order has left the path, so it
 * shows a cancelled notice instead of the steps.
 */
export function OrderStatusProgress({ status }: { status: OrderStatus }) {
  const current = STEPS.indexOf(status);
  // Cancelled is the one status off the path (ADR 0004 rule 2).
  if (current === -1) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
        <span className="font-semibold">{STATUS_LABELS[status]}.</span> This order won&apos;t be
        made.
      </p>
    );
  }
  return (
    <ol aria-label="Order status" className="grid grid-cols-4 gap-1.5">
      {STEPS.map((step, index) => {
        const state: StepState =
          index < current ? 'done' : index === current ? 'current' : 'upcoming';
        return (
          <li key={step} aria-current={state === 'current' ? 'step' : undefined}>
            <span
              aria-hidden="true"
              className={`block h-1.5 rounded-full ${state === 'upcoming' ? 'bg-stone-200' : 'bg-orange-600'}`}
            />
            <span className={`mt-1.5 block text-xs sm:text-sm ${LABEL_CLASSES[state]}`}>
              {STATUS_LABELS[step]}
              {state === 'done' ? <span className="sr-only">, done</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * `first`, then each step forward from it until the path ends. The table never
 * goes back (ADR 0004 rule 2); the repeat check only keeps a broken table from
 * looping forever.
 */
function pathFrom(first: OrderStatus): OrderStatus[] {
  const path: OrderStatus[] = [];
  for (
    let step: OrderStatus | null = first;
    step !== null && !path.includes(step);
    step = nextStatus(step)
  ) {
    path.push(step);
  }
  return path;
}
