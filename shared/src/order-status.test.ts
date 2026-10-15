import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderStatus } from './domain';
import {
  LIVE_ORDER_STATUSES,
  NEXT_STEP_LABELS,
  canTransition,
  isCancellable,
  isTerminal,
  nextStatus,
} from './order-status';

// ADR 0004 rule 2, restated here instead of read back from the module under test.
const LEGAL_TRANSITIONS: readonly (readonly [OrderStatus, OrderStatus])[] = [
  ['placed', 'preparing'],
  ['preparing', 'ready'],
  ['ready', 'delivered'],
  ['placed', 'cancelled'],
  ['preparing', 'cancelled'],
];

const ALL_PAIRS = ORDER_STATUSES.flatMap((from) => ORDER_STATUSES.map((to) => [from, to] as const));

const ILLEGAL_TRANSITIONS = ALL_PAIRS.filter(
  ([from, to]) =>
    !LEGAL_TRANSITIONS.some(([legalFrom, legalTo]) => legalFrom === from && legalTo === to),
);

describe('canTransition', () => {
  it('is checked against all 25 status pairs', () => {
    expect(ALL_PAIRS).toHaveLength(25);
    expect(LEGAL_TRANSITIONS.length + ILLEGAL_TRANSITIONS.length).toBe(25);
  });

  it.each(LEGAL_TRANSITIONS)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each(ILLEGAL_TRANSITIONS)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe('nextStatus', () => {
  it.each([
    ['placed', 'preparing'],
    ['preparing', 'ready'],
    ['ready', 'delivered'],
    ['delivered', null],
    ['cancelled', null],
  ] as const)('goes from %s to %s', (status, next) => {
    expect(nextStatus(status)).toBe(next);
  });

  it('walks the whole path from placed to delivered', () => {
    const path: OrderStatus[] = [];
    for (let status: OrderStatus | null = 'placed'; status !== null; status = nextStatus(status)) {
      path.push(status);
    }

    expect(path).toEqual(['placed', 'preparing', 'ready', 'delivered']);
  });

  it('only offers legal steps', () => {
    for (const status of ORDER_STATUSES) {
      const next = nextStatus(status);
      if (next !== null) {
        expect(canTransition(status, next)).toBe(true);
      }
    }
  });
});

describe('isCancellable', () => {
  it.each([
    { status: 'placed', cancellable: true },
    { status: 'preparing', cancellable: true },
    { status: 'ready', cancellable: false },
    { status: 'delivered', cancellable: false },
    { status: 'cancelled', cancellable: false },
  ] as const)('is $cancellable for $status', ({ status, cancellable }) => {
    expect(isCancellable(status)).toBe(cancellable);
  });

  it('agrees with canTransition to cancelled', () => {
    for (const status of ORDER_STATUSES) {
      expect(isCancellable(status)).toBe(canTransition(status, 'cancelled'));
    }
  });
});

describe('isTerminal', () => {
  it.each([
    { status: 'placed', terminal: false },
    { status: 'preparing', terminal: false },
    { status: 'ready', terminal: false },
    { status: 'delivered', terminal: true },
    { status: 'cancelled', terminal: true },
  ] as const)('is $terminal for $status', ({ status, terminal }) => {
    expect(isTerminal(status)).toBe(terminal);
  });

  it('holds exactly for the statuses no transition leaves', () => {
    for (const status of ORDER_STATUSES) {
      const canLeave = ORDER_STATUSES.some((to) => canTransition(status, to));
      expect(isTerminal(status)).toBe(!canLeave);
    }
  });
});

describe('LIVE_ORDER_STATUSES', () => {
  it('lists placed, preparing, and ready in path order', () => {
    expect(LIVE_ORDER_STATUSES).toEqual(['placed', 'preparing', 'ready']);
  });

  it('holds every status that is not terminal', () => {
    expect(LIVE_ORDER_STATUSES).toEqual(ORDER_STATUSES.filter((status) => !isTerminal(status)));
  });
});

describe('NEXT_STEP_LABELS', () => {
  it('names the staff action that leads to each status', () => {
    expect(NEXT_STEP_LABELS).toEqual({
      preparing: 'Start preparing',
      ready: 'Mark ready',
      delivered: 'Mark delivered',
    });
  });

  it.each([
    ['placed', 'Start preparing'],
    ['preparing', 'Mark ready'],
    ['ready', 'Mark delivered'],
  ] as const)('labels the step forward from %s as %j', (status, label) => {
    const next = nextStatus(status);

    expect(next).not.toBeNull();
    expect(next === null ? undefined : NEXT_STEP_LABELS[next]).toBe(label);
  });
});
