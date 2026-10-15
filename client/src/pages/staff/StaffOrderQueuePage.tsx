import type { OrderStatus } from '@fired-up-pizza/shared';
import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import { useEffect, useId, useRef, useState } from 'react';
import { changeOrderStatus, getLiveOrders, illegalTransition } from '../../api/staff-orders';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { StaleDataBanner } from '../../components/StaleDataBanner';
import {
  groupLiveOrders,
  savedOrdersAhead,
  withSavedOrders,
  type OrderAction,
} from '../../components/staff/order-queue';
import { OrderQueueSection } from '../../components/staff/OrderQueueSection';
import { DEFAULT_POLL_INTERVAL_MS, usePolling } from '../../hooks/usePolling';

/** How often order ages count up between polls. They show whole minutes. */
const AGE_TICK_MS = 15_000;

/** What the page last said about a status change. */
interface Notice {
  /** `conflict`: the server refused the change with 409, because the order had changed. */
  tone: 'success' | 'conflict';
  text: string;
}

/** Orders that status changes answered with, shown over `basis`, the list they arrived after. */
interface SavedOrders {
  basis: OrderDetails[] | undefined;
  orders: OrderDetails[];
}

/** A status change that just settled, and how. */
interface SettledChange {
  orderId: number;
  outcome: 'saved' | 'conflict' | 'failed';
}

/**
 * The kitchen's live order queue at /staff/orders: every placed, preparing,
 * and ready order, in a section per status, oldest first.
 * - It polls GET /api/staff/orders every 10 seconds (ADR 0007 rule 4), and
 *   has loading, empty, and error-with-retry states, and a stale banner that
 *   keeps the last good queue on screen when a poll fails (rule 5).
 * - Each card moves its order one step forward or cancels it, through the
 *   server's transition service. A saved change shows at once, from the
 *   server's answer, and the queue polls again.
 * - A 409 means the order changed elsewhere. The page says so and polls
 *   again, which shows where the order is now (rule 5). Any other failure
 *   stays on the order's card, with a retry.
 */
export function StaffOrderQueuePage() {
  const { data, error, lastUpdatedAt, isStale, refresh } = usePolling(
    (signal) => getLiveOrders({ signal }),
    [],
  );
  const now = useNow(AGE_TICK_MS);
  const cardIdPrefix = useId();
  const [saved, setSaved] = useState<SavedOrders>({ basis: data, orders: [] });
  const [actions, setActions] = useState<ReadonlyMap<number, OrderAction>>(() => new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // The status change that just settled, for the focus effect below.
  const settled = useRef<SettledChange | null>(null);

  // Each new list keeps only the saved orders it has not caught up with.
  if (saved.basis !== data) {
    setSaved({
      basis: data,
      orders: data === undefined ? [] : savedOrdersAhead(saved.orders, data),
    });
  }

  const cardId = (orderId: number) => `${cardIdPrefix}order-${orderId}`;

  // Where focus goes once a status change settles. The button that sent it
  // may be gone: a saved change moves the card to another section or out of
  // the queue, and a browser drops focus from a button while it is disabled.
  // - Focus that staff moved outside the order's card stays where it is.
  // - After a 409 it goes to the message saying the order changed elsewhere,
  //   since the refresh can still move or remove the card.
  // - Otherwise, when it was lost, it goes to the order's card, or to the
  //   message about the change when the card has left the queue.
  useEffect(() => {
    const change = settled.current;
    if (change === null) {
      return;
    }
    settled.current = null;
    const card = document.getElementById(cardId(change.orderId));
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (!lost && !(card?.contains(active) ?? false)) {
      return;
    }
    if (change.outcome === 'conflict') {
      noticeRef.current?.focus();
    } else if (lost) {
      (card ?? noticeRef.current)?.focus();
    }
  });

  async function changeStatus(order: OrderDetails, status: OrderStatus) {
    setActions((current) => withAction(current, order.id, { state: 'pending', to: status }));
    let failure: OrderAction | undefined;
    let outcome: SettledChange['outcome'];
    try {
      const updated = await changeOrderStatus(order.id, { status });
      setSaved((previous) => ({
        basis: previous.basis,
        orders: [...previous.orders.filter((other) => other.id !== updated.id), updated],
      }));
      setNotice({ tone: 'success', text: `Order #${updated.id} is now ${updated.status}.` });
      outcome = 'saved';
      refresh();
    } catch (reason) {
      const conflict = illegalTransition(reason);
      if (conflict === null) {
        failure = { state: 'failed', from: order.status, to: status, error: reason };
        outcome = 'failed';
      } else {
        setNotice({ tone: 'conflict', text: conflictText(order.id, conflict.currentStatus) });
        outcome = 'conflict';
        refresh();
      }
    }
    settled.current = { orderId: order.id, outcome };
    setActions((current) => withAction(current, order.id, failure));
  }

  const shown = data === undefined ? undefined : withSavedOrders(data, saved.orders);
  let queue;
  if (shown === undefined) {
    queue =
      error === null ? (
        <LoadingState label="Loading orders…" />
      ) : (
        <ErrorState title="Couldn't load the order queue" error={error} onRetry={refresh} />
      );
  } else {
    const groups = groupLiveOrders(shown);
    const isEmpty = groups.every((group) => group.orders.length === 0);
    queue = (
      <div className="space-y-4">
        {isStale ? <StaleDataBanner lastUpdatedAt={lastUpdatedAt} /> : null}
        {isEmpty ? (
          <EmptyState title="No live orders">New orders show up here on their own.</EmptyState>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {groups.map(({ status, orders }) => (
              <OrderQueueSection
                key={status}
                status={status}
                orders={orders}
                now={now}
                actions={actions}
                cardId={cardId}
                onChangeStatus={(order, to) => void changeStatus(order, to)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Order queue</h1>
        <p className="mt-2 text-stone-600">
          Every live order, oldest first. The queue refreshes every{' '}
          {DEFAULT_POLL_INTERVAL_MS / 1000} seconds.
        </p>
        {/* Always rendered, so screen readers announce each new message. */}
        <div role="status">
          {notice?.tone === 'success' ? (
            <p
              ref={noticeRef}
              tabIndex={-1}
              className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-900"
            >
              {notice.text}
            </p>
          ) : null}
        </div>
        {notice?.tone === 'conflict' ? (
          <p
            ref={noticeRef}
            role="alert"
            tabIndex={-1}
            className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900"
          >
            {notice.text}
          </p>
        ) : null}
      </div>
      {queue}
    </div>
  );
}

/** The current time in epoch milliseconds, brought up to date every `tickMs`. */
function useNow(tickMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}

/** `actions` with this order's entry set to `action`, or removed when it is undefined. */
function withAction(
  actions: ReadonlyMap<number, OrderAction>,
  orderId: number,
  action: OrderAction | undefined,
): ReadonlyMap<number, OrderAction> {
  const updated = new Map(actions);
  if (action === undefined) {
    updated.delete(orderId);
  } else {
    updated.set(orderId, action);
  }
  return updated;
}

function conflictText(orderId: number, currentStatus: OrderStatus | undefined): string {
  const where = currentStatus === undefined ? '' : ` and is now ${currentStatus}`;
  return `Order #${orderId} changed elsewhere${where}, so it wasn't updated. Refreshing the queue.`;
}
