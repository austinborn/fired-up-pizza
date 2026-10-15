import type { OrderStatus } from '@fired-up-pizza/shared';
import { isCancellable, NEXT_STEP_LABELS, nextStatus } from '@fired-up-pizza/shared/order-status';
import type { OrderDetails, OrderDetailsItem } from '@fired-up-pizza/shared/orders-api';
import { formatPhoneNumber } from '@fired-up-pizza/shared/phone';
import { useEffect, useId, useRef, useState } from 'react';
import { errorMessage } from '../../api/http';
import { formatCents } from '../../lib/money';
import { formatMinutesAgo } from '../../lib/time';
import type { OrderAction } from './order-queue';

// Tailwind only (ADR 0007 rule 6).
const BUTTON =
  'rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';
const ADVANCE_BUTTON = `${BUTTON} bg-orange-600 text-white hover:bg-orange-700 focus-visible:outline-orange-600 disabled:hover:bg-orange-600`;
const CANCEL_BUTTON = `${BUTTON} border border-red-300 bg-white text-red-700 hover:bg-red-50 focus-visible:outline-red-700 disabled:hover:bg-white`;
const CONFIRM_CANCEL_BUTTON = `${BUTTON} bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700 disabled:hover:bg-red-700`;
const SECONDARY_BUTTON = `${BUTTON} border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 focus-visible:outline-stone-600 disabled:hover:bg-white`;

interface OrderCardProps {
  order: OrderDetails;
  /** The id of the card's root element. The page focuses it after a status change. */
  id: string;
  /** What the order's age counts to, in epoch milliseconds. */
  now: number;
  /** This order's status change in flight, or the last one that failed. */
  action: OrderAction | undefined;
  /** Sends a status change for this order. The page tracks it and passes it back as `action`. */
  onChangeStatus: (order: OrderDetails, status: OrderStatus) => void;
}

/**
 * One live order on the staff queue: its number and age, the customer's phone
 * number, the total to collect at the counter, every line with its size,
 * crust, toppings, and quantity, and the customer's notes.
 *
 * The buttons come from the shared transition table (ADR 0004 rule 3): one
 * button moves the order a step forward, labelled for that step, and Cancel
 * shows only while the order can still be cancelled. Cancel asks first; the
 * question goes away if the order's status changes meanwhile. While a change
 * is in flight every button on the card is disabled. A change that fails for
 * any reason but a 409 shows here with a retry until the order's status
 * changes; the page handles a 409.
 */
export function OrderCard({ order, id, now, action, onChangeStatus }: OrderCardProps) {
  const headingId = useId();
  const confirmTextId = useId();
  // Each status has its own section, so a status change moves the card and
  // remounts it: the question never outlives the status it was asked about.
  const [confirming, setConfirming] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'keep' | 'cancel' | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) {
      return;
    }
    pendingFocus.current = null;
    (target === 'keep' ? keepButton : cancelButton).current?.focus();
  });

  const pendingTo = action?.state === 'pending' ? action.to : null;
  const pending = pendingTo !== null;
  const failure = action?.state === 'failed' && action.from === order.status ? action : null;
  const next = nextStatus(order.status);
  const cancellable = isCancellable(order.status);

  function askToCancel() {
    setConfirming(true);
    pendingFocus.current = 'keep';
  }

  function keepOrder() {
    setConfirming(false);
    pendingFocus.current = 'cancel';
  }

  function cancelOrder() {
    setConfirming(false);
    onChangeStatus(order, 'cancelled');
  }

  return (
    <li
      id={id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 id={headingId} className="text-lg font-semibold text-stone-900">
          Order #{order.id}
        </h3>
        <p className="shrink-0 rounded-full bg-stone-100 px-2.5 py-0.5 text-sm font-medium text-stone-700">
          <span className="sr-only">Placed </span>
          <time dateTime={order.createdAt}>{formatMinutesAgo(order.createdAt, now)}</time>
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <div>
          <dt className="sr-only">Phone</dt>
          <dd className="font-medium text-stone-900">{formatPhoneNumber(order.phoneNumber)}</dd>
        </div>
        <div className="flex gap-1">
          <dt className="text-stone-600">Total</dt>
          <dd className="font-medium text-stone-900">{formatCents(order.totalCents)}</dd>
        </div>
      </dl>

      {/* role="list" keeps the list semantics that Safari drops from unstyled lists. */}
      <ul role="list" className="divide-y divide-stone-100 border-y border-stone-100">
        {order.items.map((item) => (
          <OrderCardItem key={item.id} item={item} />
        ))}
      </ul>

      {order.notes === '' ? null : (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p className="font-semibold">Notes</p>
          <p className="break-words whitespace-pre-line">{order.notes}</p>
        </div>
      )}

      {failure === null ? null : (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          <p>
            Couldn&apos;t mark order #{order.id} as {failure.to}. {errorMessage(failure.error)}
          </p>
          <button
            type="button"
            onClick={() => onChangeStatus(order, failure.to)}
            className={SECONDARY_BUTTON}
          >
            Try again <span className="sr-only">for order #{order.id}</span>
          </button>
        </div>
      )}

      {confirming ? (
        <div
          role="group"
          aria-labelledby={confirmTextId}
          className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2"
        >
          <p id={confirmTextId} className="text-sm font-medium text-red-900">
            Cancel order #{order.id}? This can&apos;t be undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={cancelOrder}
              className={CONFIRM_CANCEL_BUTTON}
            >
              Yes, cancel order <span className="sr-only">#{order.id}</span>
            </button>
            <button
              ref={keepButton}
              type="button"
              disabled={pending}
              onClick={keepOrder}
              className={SECONDARY_BUTTON}
            >
              Keep order <span className="sr-only">#{order.id}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {next === null ? null : (
            <button
              type="button"
              disabled={pending}
              onClick={() => onChangeStatus(order, next)}
              className={ADVANCE_BUTTON}
            >
              {pendingTo === next ? 'Saving…' : NEXT_STEP_LABELS[next]}{' '}
              <span className="sr-only">order #{order.id}</span>
            </button>
          )}
          {cancellable ? (
            <button
              ref={cancelButton}
              type="button"
              disabled={pending}
              onClick={askToCancel}
              className={CANCEL_BUTTON}
            >
              {pendingTo === 'cancelled' ? 'Cancelling…' : 'Cancel order'}{' '}
              <span className="sr-only">#{order.id}</span>
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** One order line, as the kitchen makes it. */
function OrderCardItem({ item }: { item: OrderDetailsItem }) {
  const toppings = item.toppings.map((topping) => topping.toppingName).join(', ');
  return (
    <li className="py-2">
      <p className="font-medium text-stone-900">
        {item.quantity} × {item.menuItemName}
      </p>
      <p className="text-sm text-stone-600">
        {item.sizeName}, {item.crustName}
      </p>
      <p className="text-sm text-stone-600">
        {toppings === '' ? 'No extra toppings' : `Toppings: ${toppings}`}
      </p>
    </li>
  );
}
