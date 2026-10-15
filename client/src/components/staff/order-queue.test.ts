import type { OrderStatus } from '@fired-up-pizza/shared';
import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import { describe, expect, it } from 'vitest';
import { groupLiveOrders, savedOrdersAhead, withSavedOrders } from './order-queue';

/**
 * An order whose status history walks `path`, one event per status, as the
 * server records it (ADR 0004 rule 4). Only the fields these rules read matter.
 */
function order(id: number, ...path: [OrderStatus, ...OrderStatus[]]): OrderDetails {
  const createdAt = `2026-10-15T18:${String(id).padStart(2, '0')}:00.000Z`;
  return {
    id,
    phoneNumber: '+12125550142',
    status: path[path.length - 1] ?? 'placed',
    totalCents: 1299,
    notes: '',
    createdAt,
    updatedAt: createdAt,
    items: [],
    statusEvents: path.map((status, index) => ({
      id: id * 10 + index,
      fromStatus: index === 0 ? null : (path[index - 1] ?? null),
      toStatus: status,
      changedAt: createdAt,
    })),
  };
}

const ids = (orders: readonly OrderDetails[]) => orders.map((listed) => listed.id);

describe('groupLiveOrders', () => {
  it('makes one group per live status, in path order, keeping list order inside each', () => {
    const list = [
      order(1, 'placed', 'preparing', 'ready'),
      order(2, 'placed', 'preparing'),
      order(3, 'placed'),
      order(4, 'placed', 'preparing'),
      order(5, 'placed'),
    ];

    const groups = groupLiveOrders(list);

    expect(groups.map(({ status, orders }) => [status, ids(orders)])).toEqual([
      ['placed', [3, 5]],
      ['preparing', [2, 4]],
      ['ready', [1]],
    ]);
  });

  it('leaves delivered and cancelled orders out', () => {
    const groups = groupLiveOrders([
      order(1, 'placed', 'preparing', 'ready', 'delivered'),
      order(2, 'placed', 'cancelled'),
      order(3, 'placed'),
    ]);

    expect(groups.map(({ orders }) => ids(orders))).toEqual([[3], [], []]);
  });

  it('gives three empty groups for an empty list', () => {
    expect(groupLiveOrders([])).toEqual([
      { status: 'placed', orders: [] },
      { status: 'preparing', orders: [] },
      { status: 'ready', orders: [] },
    ]);
  });
});

describe('withSavedOrders', () => {
  const list = [order(1, 'placed'), order(2, 'placed', 'preparing'), order(3, 'placed')];

  it('returns the list itself when nothing is saved', () => {
    expect(withSavedOrders(list, [])).toBe(list);
  });

  it('shows a saved copy with more status events in place of the listed one', () => {
    const saved = order(1, 'placed', 'preparing');

    const shown = withSavedOrders(list, [saved]);

    expect(shown).toEqual([saved, list[1], list[2]]);
    expect(shown[0]).toBe(saved);
  });

  it('keeps the listed copy once it has as many status events as the saved one, or more', () => {
    const caughtUp = order(2, 'placed', 'preparing');
    const behind = order(3, 'placed');
    const newerList = [list[0]!, list[1]!, order(3, 'placed', 'preparing')];

    expect(withSavedOrders(list, [caughtUp])[1]).toBe(list[1]);
    expect(withSavedOrders(newerList, [behind])[2]).toBe(newerList[2]);
  });

  it('leaves out a saved order that the list no longer has', () => {
    const delivered = order(9, 'placed', 'preparing', 'ready', 'delivered');

    expect(ids(withSavedOrders(list, [delivered]))).toEqual([1, 2, 3]);
  });

  it('keeps a saved order that left the live queue in its place, for the page to drop', () => {
    const cancelled = order(3, 'placed', 'cancelled');

    const shown = withSavedOrders(list, [cancelled]);

    expect(shown[2]).toBe(cancelled);
    expect(groupLiveOrders(shown).flatMap(({ orders }) => ids(orders))).toEqual([1, 2]);
  });
});

describe('savedOrdersAhead', () => {
  it('keeps only saved copies that the list has not caught up with', () => {
    const list = [
      order(1, 'placed'),
      order(2, 'placed', 'preparing'),
      order(3, 'placed', 'preparing', 'ready'),
    ];
    const ahead = order(1, 'placed', 'preparing');
    const caughtUp = order(2, 'placed', 'preparing');
    const behind = order(3, 'placed', 'preparing');
    const gone = order(4, 'placed', 'cancelled');

    expect(savedOrdersAhead([ahead, caughtUp, behind, gone], list)).toEqual([ahead]);
  });

  it('keeps nothing when the list is empty', () => {
    expect(savedOrdersAhead([order(1, 'placed', 'preparing')], [])).toEqual([]);
  });
});
