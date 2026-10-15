import { isTerminal } from '@fired-up-pizza/shared/order-status';
import type { OrderDetails, OrderDetailsItem } from '@fired-up-pizza/shared/orders-api';
import { formatPhoneNumber, normalizePhoneNumber } from '@fired-up-pizza/shared/phone';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { lookupOrders } from '../../api/orders';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { OrderStatusProgress } from '../../components/OrderStatusProgress';
import { StaleDataBanner } from '../../components/StaleDataBanner';
import { usePolling } from '../../hooks/usePolling';
import { formatCents } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { PHONE_STORAGE_KEY } from './CartPage';

const INPUT_CLASS =
  'block w-full min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-2 focus:outline-offset-1 focus:outline-orange-600';

const LINK_CLASS = 'font-medium text-orange-700 hover:underline';

/** A phone number the page is looking up. */
interface Lookup {
  /** E.164, from normalizePhoneNumber. */
  phoneNumber: string;
  /** Changes on every submit, so each one starts a new lookup, even for the same number. */
  id: number;
}

/** The phone form as the page opens. */
interface InitialForm {
  phone: string;
  error: string | undefined;
  lookup: Lookup | null;
}

/**
 * Order tracking at /track: a customer enters the phone number they ordered
 * with and sees those orders, with live status.
 * - The form opens with the number from `?phone=`, or else the one checkout
 *   saved (PHONE_STORAGE_KEY), and looks a valid number up at once. The
 *   number is checked with @fired-up-pizza/shared/phone (ADR 0005 rule 2), so
 *   an invalid one shows its error under the field and sends no request. The
 *   page never writes the number into the URL.
 * - The orders refresh by polling GET /api/orders?phone= every 10 seconds,
 *   usePolling's default (ADR 0007 rule 4). Submitting a number starts a new
 *   lookup, and polling stops when the page closes.
 * - The orders have loading, empty, and error-with-retry states, and a stale
 *   banner that keeps the last good orders on screen when a poll fails (rule
 *   5).
 * - Each order shows its number, when it was placed, its items with their
 *   customizations, its stored total (ADR 0003 rule 4), and its status. Active
 *   orders come first, then past ones, each newest first as the server sends
 *   them.
 */
export function OrderTrackingPage() {
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => initialForm(searchParams.get('phone')));
  const [phone, setPhone] = useState(initial.phone);
  const [error, setError] = useState(initial.error);
  const [lookup, setLookup] = useState(initial.lookup);
  const id = useId();
  const ids = { phone: `${id}-phone`, hint: `${id}-phone-hint`, error: `${id}-phone-error` };
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = useRef(false);

  // After a submit with an invalid number, moves focus to the field once its
  // error is on screen, so screen readers read the error with it.
  useEffect(() => {
    if (focusInput.current) {
      focusInput.current = false;
      inputRef.current?.focus();
    }
  });

  function submit() {
    const phoneNumber = normalizePhoneNumber(phone);
    if (phoneNumber === null) {
      setError(phoneError(phone));
      setLookup(null);
      focusInput.current = true;
      return;
    }
    setError(undefined);
    setLookup((previous) => ({ phoneNumber, id: (previous?.id ?? 0) + 1 }));
  }

  return (
    <section className="max-w-2xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Track your order</h1>
        <p className="text-stone-600">
          Enter the phone number you ordered with to see how your orders are doing.
        </p>
      </div>

      <form
        noValidate
        className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={ids.phone} className="block text-sm font-medium text-stone-800">
          Phone number
        </label>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            ref={inputRef}
            id={ids.phone}
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={error === undefined ? ids.hint : `${ids.hint} ${ids.error}`}
            onChange={(event) => {
              setPhone(event.target.value);
              setError(undefined);
            }}
            className={`${INPUT_CLASS} ${error === undefined ? 'border-stone-300' : 'border-red-600'}`}
          />
          <button
            type="submit"
            className="shrink-0 rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
          >
            Find orders
          </button>
        </div>
        <p id={ids.hint} className="mt-1 text-xs text-stone-500">
          US and Canadian numbers only.
        </p>
        {error === undefined ? null : (
          <p id={ids.error} className="mt-1 text-sm text-red-700">
            {error}
          </p>
        )}
      </form>

      {lookup === null ? null : <OrderLookup key={lookup.id} phoneNumber={lookup.phoneNumber} />}
    </section>
  );
}

/**
 * One phone number's orders, polled while this is mounted: a new lookup
 * remounts it, and unmounting stops the polling.
 */
function OrderLookup({ phoneNumber }: { phoneNumber: string }) {
  const {
    data: orders,
    error,
    isStale,
    lastUpdatedAt,
    refresh,
  } = usePolling((signal) => lookupOrders(phoneNumber, { signal }), [phoneNumber]);

  let content;
  if (orders === undefined) {
    content =
      error === null ? (
        <LoadingState label="Looking up your orders…" />
      ) : (
        <ErrorState title="Couldn't look up your orders" error={error} onRetry={refresh} />
      );
  } else {
    content = (
      <>
        {isStale ? <StaleDataBanner lastUpdatedAt={lastUpdatedAt} /> : null}
        {orders.length === 0 ? (
          <EmptyState title="No orders for this number">
            Check the number you ordered with, or{' '}
            <Link to="/" className={LINK_CLASS}>
              browse the menu
            </Link>{' '}
            to place an order.
          </EmptyState>
        ) : (
          <>
            <OrderSection
              title="Active orders"
              orders={orders.filter((order) => !isTerminal(order.status))}
            />
            <OrderSection
              title="Past orders"
              orders={orders.filter((order) => isTerminal(order.status))}
            />
          </>
        )}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Orders for{' '}
        <span className="font-medium text-stone-900">{formatPhoneNumber(phoneNumber)}</span>.
        Statuses update automatically.
      </p>
      {content}
    </div>
  );
}

/** A titled list of orders, or nothing when there are none. */
function OrderSection({ title, orders }: { title: string; orders: OrderDetails[] }) {
  const headingId = useId();
  if (orders.length === 0) {
    return null;
  }
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h2 id={headingId} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {/* role="list" keeps the list semantics that Safari drops from unstyled lists. */}
      <ul role="list" aria-labelledby={headingId} className="space-y-4">
        {orders.map((order) => (
          <TrackedOrder key={order.id} order={order} />
        ))}
      </ul>
    </section>
  );
}

/** One order: its number, when it was placed, its status, its items, and its stored total. */
function TrackedOrder({ order }: { order: OrderDetails }) {
  const headingId = useId();
  return (
    <li
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="text-lg font-semibold text-stone-900">
          Order #{order.id}
        </h3>
        <p className="text-sm text-stone-600">
          Ordered <time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time>
        </p>
      </div>
      <OrderStatusProgress status={order.status} />
      <ul
        role="list"
        aria-label="Items"
        className="divide-y divide-stone-100 border-y border-stone-100"
      >
        {order.items.map((item) => (
          <TrackedOrderItem key={item.id} item={item} />
        ))}
      </ul>
      <p className="flex justify-between font-semibold text-stone-900">
        <span>Total</span>
        <span>{formatCents(order.totalCents)}</span>
      </p>
    </li>
  );
}

/** An order line with its customizations: size, crust, and toppings. */
function TrackedOrderItem({ item }: { item: OrderDetailsItem }) {
  const { quantity, menuItemName, sizeName, crustName, toppings } = item;
  return (
    <li className="py-2">
      <p className="font-medium text-stone-900">
        {quantity} × {menuItemName}
      </p>
      <p className="text-sm text-stone-600">
        {sizeName}, {crustName}
      </p>
      {toppings.length === 0 ? null : (
        <p className="text-sm text-stone-600">
          Toppings: {toppings.map((topping) => topping.toppingName).join(', ')}
        </p>
      )}
    </li>
  );
}

/**
 * How the page opens: with the number from `?phone=` if there is one, or else
 * the number checkout saved. A valid number is looked up at once. An invalid
 * `?phone=` shows its error, and a saved number that is not valid is ignored.
 */
function initialForm(queryPhone: string | null): InitialForm {
  const phone = queryPhone !== null && queryPhone.trim() !== '' ? queryPhone : savedPhoneNumber();
  if (phone === null) {
    return { phone: '', error: undefined, lookup: null };
  }
  const phoneNumber = normalizePhoneNumber(phone);
  return phoneNumber === null
    ? { phone, error: phoneError(phone), lookup: null }
    : { phone: formatPhoneNumber(phoneNumber), error: undefined, lookup: { phoneNumber, id: 0 } };
}

/** The valid number checkout saved, or null. Storage that is blocked counts as nothing saved. */
function savedPhoneNumber(): string | null {
  try {
    const saved = window.localStorage.getItem(PHONE_STORAGE_KEY);
    return saved === null ? null : normalizePhoneNumber(saved);
  } catch {
    return null;
  }
}

/** The error for a number that normalizePhoneNumber did not accept. */
function phoneError(phone: string): string {
  return phone.trim() === ''
    ? 'Enter your phone number.'
    : 'Enter a 10-digit US or Canadian phone number.';
}
