import { isOrderStatus } from '@fired-up-pizza/shared';
import type {
  OrderDetails,
  OrderDetailsItem,
  OrderDetailsTopping,
} from '@fired-up-pizza/shared/orders-api';
import { formatPhoneNumber } from '@fired-up-pizza/shared/phone';
import { computeLineTotalCents } from '@fired-up-pizza/shared/pricing';
import { useId } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { formatCents } from '../../lib/money';
import { formatTime } from '../../lib/time';

/** The parts of OrderDetails this page shows. */
interface ShownOrder extends Pick<
  OrderDetails,
  'id' | 'phoneNumber' | 'status' | 'totalCents' | 'notes' | 'createdAt'
> {
  items: ShownItem[];
}

interface ShownItem extends Pick<
  OrderDetailsItem,
  'id' | 'quantity' | 'unitPriceCents' | 'menuItemName' | 'sizeName' | 'crustName'
> {
  toppings: Pick<OrderDetailsTopping, 'toppingId' | 'toppingName'>[];
}

const primaryLinkClass =
  'rounded-md bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600';

/**
 * The confirmation at /order-confirmation/:orderId. Checkout navigates here
 * with the OrderDetails that POST /api/orders returned as router state, so the
 * page shows the server's snapshot prices and total, not the cart's estimates
 * (ADR 0003 rule 5). It sends no requests: there is no endpoint for a single
 * order (ADR 0006 rule 2). A visit without that state, such as a typed or
 * shared link or a new tab, links to order tracking instead.
 */
export function OrderConfirmationPage() {
  const { orderId } = useParams();
  // Router state survives a reload, so it can predate this version of the
  // page. Show it only when it is an order, and the one this URL names.
  const state: unknown = useLocation().state;
  const order = isShownOrder(state) && String(state.id) === orderId ? state : null;
  return order === null ? <OrderNotShown /> : <PlacedOrder order={order} />;
}

function PlacedOrder({ order }: { order: ShownOrder }) {
  const itemsHeadingId = useId();
  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <p className="font-semibold text-green-700">Thanks! Your order is in.</p>
        <h1 className="text-2xl font-bold tracking-tight">Order #{order.id}</h1>
        <p className="text-stone-600">
          Placed at <time dateTime={order.createdAt}>{formatTime(order.createdAt)}</time>
          {' · '}
          Status: <span className="font-semibold text-stone-900">{statusText(order.status)}</span>
        </p>
      </div>

      <section
        aria-labelledby={itemsHeadingId}
        className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
      >
        <h2 id={itemsHeadingId} className="text-lg font-semibold tracking-tight">
          Your order
        </h2>
        {/* role="list" keeps the list semantics that Safari drops from unstyled lists. */}
        <ul role="list" aria-labelledby={itemsHeadingId} className="mt-3 divide-y divide-stone-200">
          {order.items.map((item) => (
            <OrderedItem key={item.id} item={item} />
          ))}
        </ul>
        <p className="mt-3 flex justify-between border-t border-stone-300 pt-3 text-lg font-semibold">
          <span>Total</span>
          <span>{formatCents(order.totalCents)}</span>
        </p>
      </section>

      {order.notes === '' ? null : (
        <section className="space-y-1">
          <h2 className="font-semibold">Notes for the kitchen</h2>
          <p className="break-words whitespace-pre-wrap text-stone-700">{order.notes}</p>
        </section>
      )}

      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <span className="font-semibold">Pay at the counter.</span> You&apos;ll pay{' '}
        {formatCents(order.totalCents)} when you pick up your order.
      </p>

      <div className="space-y-4">
        <p className="text-stone-600">
          To see how your order is doing, track it with {formatPhoneNumber(order.phoneNumber)}, the
          phone number you ordered with.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link to="/track" className={primaryLinkClass}>
            Track your order
          </Link>
          <Link to="/" className="font-medium text-orange-700 hover:underline">
            Back to the menu
          </Link>
        </div>
      </div>
    </section>
  );
}

/** One ordered line, priced from its stored unit price (ADR 0003 rules 2 and 4). */
function OrderedItem({ item }: { item: ShownItem }) {
  const { quantity, unitPriceCents, menuItemName, sizeName, crustName, toppings } = item;
  return (
    <li className="flex justify-between gap-4 py-3">
      <div>
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
        {quantity === 1 ? null : (
          <p className="text-sm text-stone-600">{formatCents(unitPriceCents)} each</p>
        )}
      </div>
      <p className="font-medium text-stone-900">
        {formatCents(computeLineTotalCents(unitPriceCents, quantity))}
      </p>
    </li>
  );
}

function OrderNotShown() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight">Order confirmation</h1>
      <p className="text-stone-600">
        Order details show here only right after checkout. To see how your order is doing, look it
        up with the phone number you ordered with.
      </p>
      <p>
        <Link to="/track" className="font-medium text-orange-700 hover:underline">
          Track your order
        </Link>
      </p>
    </section>
  );
}

/** The status as a customer reads it, e.g. "Placed". */
function statusText(status: ShownOrder['status']): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function isShownOrder(value: unknown): value is ShownOrder {
  return (
    isRecord(value) &&
    isId(value.id) &&
    typeof value.phoneNumber === 'string' &&
    isOrderStatus(value.status) &&
    isWholeNumber(value.totalCents) &&
    typeof value.notes === 'string' &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.items) &&
    value.items.every(isShownItem)
  );
}

function isShownItem(value: unknown): value is ShownItem {
  return (
    isRecord(value) &&
    isId(value.id) &&
    isWholeNumber(value.quantity) &&
    isWholeNumber(value.unitPriceCents) &&
    typeof value.menuItemName === 'string' &&
    typeof value.sizeName === 'string' &&
    typeof value.crustName === 'string' &&
    Array.isArray(value.toppings) &&
    value.toppings.every(
      (topping) =>
        isRecord(topping) && isId(topping.toppingId) && typeof topping.toppingName === 'string',
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Server ids are positive safe integers. */
function isId(value: unknown): value is number {
  return isWholeNumber(value) && value > 0;
}

/** Cents and quantities are non-negative safe integers (ADR 0003 rule 1). */
function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
