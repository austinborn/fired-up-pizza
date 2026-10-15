import type { OrderStatus } from '@fired-up-pizza/shared';
import type { LiveOrderStatus } from '@fired-up-pizza/shared/order-status';
import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import { useId } from 'react';
import { ORDER_QUEUE_SECTIONS, type OrderAction } from './order-queue';
import { OrderCard } from './OrderCard';

interface OrderQueueSectionProps {
  status: LiveOrderStatus;
  /** This section's orders, oldest first. */
  orders: readonly OrderDetails[];
  /** What order ages count to, in epoch milliseconds. */
  now: number;
  /** Status changes in flight or failed, by order id. */
  actions: ReadonlyMap<number, OrderAction>;
  /** The id of an order card's root element. */
  cardId: (orderId: number) => string;
  onChangeStatus: (order: OrderDetails, status: OrderStatus) => void;
}

/** One column of the staff queue: the live orders in one status, oldest first. */
export function OrderQueueSection({
  status,
  orders,
  now,
  actions,
  cardId,
  onChangeStatus,
}: OrderQueueSectionProps) {
  const headingId = useId();
  const { title, emptyText } = ORDER_QUEUE_SECTIONS[status];
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3">
      <h2 id={headingId} className="text-lg font-semibold tracking-tight text-stone-900">
        {title}
      </h2>
      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">
          {emptyText}
        </p>
      ) : (
        // role="list" keeps the list semantics that Safari drops from unstyled lists.
        <ul role="list" aria-labelledby={headingId} className="space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              id={cardId(order.id)}
              now={now}
              action={actions.get(order.id)}
              onChangeStatus={onChangeStatus}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
