import type { OrderStatus } from '@fired-up-pizza/shared';
import type { OrderDetails, OrderDetailsItem } from '@fired-up-pizza/shared/orders-api';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { PHONE_STORAGE_KEY } from './CartPage';
import { OrderTrackingPage } from './OrderTrackingPage';

// Every test runs on Vitest's fake clock, so polls and fetch answers happen
// only when the test moves time on, and nothing waits on real time. Clicks run
// inside act() with getBy* queries: user-event and findBy* wait on timers that
// only Jest's fake clock advances. The page renders in StrictMode, as main.tsx
// renders it. Its development double mount starts one extra poll and aborts it
// at once; the fake server treats that as an aborted fetch, and the request
// counts below leave aborted requests out.

/** 6:00 PM local time, when every test starts. */
const START = new Date(2026, 9, 15, 18, 0, 0);

const PHONE = '+12125550142';
const OTHER_PHONE = '+13125550199';

const LOOKUP_PATH = '/api/orders';

function minutesAgo(minutes: number): string {
  return new Date(START.getTime() - minutes * 60_000).toISOString();
}

function item(
  id: number,
  quantity: number,
  menuItemName: string,
  sizeName: string,
  crustName: string,
  toppingNames: string[] = [],
): OrderDetailsItem {
  return {
    id,
    menuItemId: id,
    sizeId: 1,
    crustId: 1,
    quantity,
    unitPriceCents: 1299,
    menuItemName,
    sizeName,
    crustName,
    toppings: toppingNames.map((toppingName, index) => ({
      toppingId: index + 1,
      priceCents: 150,
      toppingName,
    })),
  };
}

/** An order as the server sends it once it was placed, `minutes` before START. */
function placedOrder(
  id: number,
  minutes: number,
  fields: Partial<Pick<OrderDetails, 'phoneNumber' | 'totalCents' | 'items'>> = {},
): OrderDetails {
  const createdAt = minutesAgo(minutes);
  return {
    id,
    phoneNumber: PHONE,
    status: 'placed',
    totalCents: 1299,
    notes: '',
    createdAt,
    updatedAt: createdAt,
    items: [item(id * 10, 1, 'Pepperoni', 'Large', 'Hand-Tossed')],
    statusEvents: [{ id: id * 10, fromStatus: null, toStatus: 'placed', changedAt: createdAt }],
    ...fields,
  };
}

/** The order once the kitchen moved it to `status`: one more status event (ADR 0004 rule 4). */
function moved(
  order: OrderDetails,
  status: OrderStatus,
  changedAt = new Date().toISOString(),
): OrderDetails {
  return {
    ...order,
    status,
    updatedAt: changedAt,
    statusEvents: [
      ...order.statusEvents,
      {
        id: order.id * 10 + order.statusEvents.length,
        fromStatus: order.status,
        toStatus: status,
        changedAt,
      },
    ],
  };
}

/** Placed 2 minutes ago; the kitchen has not started it. */
const placed47 = placedOrder(47, 2);
/** Placed 30 minutes ago and handed over 10 minutes ago. */
const delivered46 = moved(
  moved(moved(placedOrder(46, 30), 'preparing', minutesAgo(28)), 'ready', minutesAgo(15)),
  'delivered',
  minutesAgo(10),
);
/**
 * Placed 40 minutes ago and still in the kitchen. Its lines' stored unit
 * prices add up to $38.97, while its stored total is $56.97: the page must
 * show the stored total (ADR 0003 rule 4), never a sum of its own.
 */
const preparing45 = moved(
  placedOrder(45, 40, {
    totalCents: 5697,
    items: [
      item(451, 2, 'Margherita', 'Medium', 'Stuffed Crust', ['Mushrooms', 'Fresh Basil']),
      item(452, 1, 'Cheese', 'Small', 'Thin & Crispy'),
    ],
  }),
  'preparing',
  minutesAgo(35),
);
/** Placed yesterday at 4:00 PM, then cancelled. */
const cancelled44 = moved(placedOrder(44, 26 * 60), 'cancelled', minutesAgo(26 * 60 - 3));

/** PHONE's orders as GET /api/orders?phone= lists them: newest first, in every status. */
const PHONE_ORDERS = [placed47, delivered46, preparing45, cancelled44];

/** An order placed with OTHER_PHONE. */
const otherPlaced50 = placedOrder(50, 5, { phoneNumber: OTHER_PHONE });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

type Answer = Response | Error | Promise<Response>;

/** The phone parameter of a lookup URL, decoded, as the server reads it. */
function phoneParam(input: RequestInfo | URL): string | null {
  const url = new URL(typeof input === 'string' ? input : '', 'http://localhost');
  return url.pathname === LOOKUP_PATH ? url.searchParams.get('phone') : null;
}

/**
 * A stand-in for the API that keeps each number's orders, like the real
 * server: GET /api/orders?phone= answers with that number's orders, newest
 * first. A test can queue other answers for the next lookups, or move an order
 * as the kitchen would. A request aborted before it is answered gets an
 * AbortError and uses up no queued answer. Any other request fails as if the
 * server were down.
 */
function fakeServer(initial: Readonly<Record<string, readonly OrderDetails[]>> = {}) {
  const ordersByPhone = new Map(
    Object.entries(initial).map(([phoneNumber, orders]) => [phoneNumber, [...orders]]),
  );
  const nextAnswers: Answer[] = [];

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    await Promise.resolve();
    if (init?.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }
    const phoneNumber = phoneParam(input);
    let answer: Answer | undefined;
    if ((init?.method ?? 'GET') === 'GET' && phoneNumber !== null) {
      answer = nextAnswers.shift() ?? jsonResponse(ordersByPhone.get(phoneNumber) ?? []);
    }
    if (answer === undefined || answer instanceof Error) {
      throw answer ?? new TypeError('Failed to fetch');
    }
    return answer;
  });

  return {
    fetchSpy,
    /** The numbers the page looked up, one per request it did not abort, oldest first. */
    lookups(): (string | null)[] {
      return fetchSpy.mock.calls
        .filter(([, init]) => init?.signal?.aborted !== true)
        .map(([input]) => phoneParam(input));
    },
    /** Answers the next lookups with these instead of the stored orders. */
    answerNext(...answers: Answer[]) {
      nextAnswers.push(...answers);
    },
    /** Moves an order as the kitchen would. The page sees it on its next poll. */
    move(orderId: number, status: OrderStatus) {
      for (const [phoneNumber, orders] of ordersByPhone) {
        ordersByPhone.set(
          phoneNumber,
          orders.map((order) => (order.id === orderId ? moved(order, status) : order)),
        );
      }
    },
    /** Adds a new order for its number; it is the newest. */
    add(order: OrderDetails) {
      ordersByPhone.set(order.phoneNumber, [
        order,
        ...(ordersByPhone.get(order.phoneNumber) ?? []),
      ]);
    },
  };
}

/** Shows the router location, to prove the page never writes the number into the URL. */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{`${pathname}${search}`}</p>;
}

/** Renders the page as main.tsx does, in StrictMode, at a /track URL. */
function renderTracking(route = '/track') {
  return renderWithProviders(
    <StrictMode>
      <OrderTrackingPage />
      <LocationProbe />
    </StrictMode>,
    { route },
  );
}

/** Lets fetch answers, and the renders they cause, run without moving the clock. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Moves the clock on, running the polls that fall due on the way. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Presses a button, then lets what it sends settle. */
async function press(button: HTMLElement) {
  await act(async () => {
    button.click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function phoneField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Phone number' });
}

/** Replaces what the phone field holds, as typing or pasting does. */
function typePhone(value: string) {
  fireEvent.change(phoneField(), { target: { value } });
}

async function findOrders() {
  await press(screen.getByRole('button', { name: 'Find orders' }));
}

function orderCard(orderId: number): HTMLElement {
  return screen.getByRole('listitem', { name: `Order #${orderId}` });
}

/** The step the order's status indicator marks as current, e.g. "Preparing". */
function currentStep(orderId: number): string | null | undefined {
  const steps = within(orderCard(orderId)).getByRole('list', { name: 'Order status' });
  return within(steps)
    .getAllByRole('listitem')
    .find((step) => step.getAttribute('aria-current') === 'step')?.textContent;
}

/** The order numbers in a section, top to bottom. */
function ordersIn(section: 'Active orders' | 'Past orders'): (string | null)[] {
  return within(screen.getByRole('region', { name: section }))
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
}

/** The line that says whose orders the page shows. */
function lookupLine(): HTMLElement | null {
  return screen.queryByText(/^Orders for/);
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  // Unmount while the fake clock still runs, so no poll outlives the test.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// No real time passes in these tests, but a heavily loaded machine can still
// make one run long, so each gets 15 s.
describe('OrderTrackingPage: the phone form', { timeout: 15_000 }, () => {
  it('opens with the number checkout saved and looks it up at once', async () => {
    localStorage.setItem(PHONE_STORAGE_KEY, PHONE);
    const server = fakeServer({ [PHONE]: PHONE_ORDERS });

    renderTracking();

    expect(screen.getByRole('heading', { level: 1, name: 'Track your order' })).toBeVisible();
    expect(phoneField()).toHaveValue('(212) 555-0142');
    expect(phoneField()).toHaveAccessibleDescription('US and Canadian numbers only.');
    expect(screen.getByRole('status')).toHaveTextContent('Looking up your orders…');

    await flush();

    expect(server.lookups()).toEqual([PHONE]);
    expect(lookupLine()).toHaveTextContent(
      /^Orders for \(212\) 555-0142\. Statuses update automatically\.$/,
    );
    expect(orderCard(47)).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    { name: 'ten digits', query: '3125550199' },
    { name: 'an encoded +1', query: '%2B13125550199' },
    // A bare + reads as a space, which the shared phone rules drop.
    { name: 'a bare +1', query: '+13125550199' },
    { name: 'punctuation', query: '(312)%20555-0199' },
  ])('prefers a ?phone= number, written with $name, to the saved one', async ({ query }) => {
    localStorage.setItem(PHONE_STORAGE_KEY, PHONE);
    const server = fakeServer({ [PHONE]: PHONE_ORDERS, [OTHER_PHONE]: [otherPlaced50] });

    renderTracking(`/track?phone=${query}`);
    await flush();

    expect(phoneField()).toHaveValue('(312) 555-0199');
    expect(server.lookups()).toEqual([OTHER_PHONE]);
    expect(orderCard(50)).toBeVisible();
    expect(screen.queryByRole('listitem', { name: 'Order #47' })).not.toBeInTheDocument();
  });

  it('falls back to the saved number when ?phone= is blank', async () => {
    localStorage.setItem(PHONE_STORAGE_KEY, PHONE);
    const server = fakeServer({ [PHONE]: PHONE_ORDERS });

    renderTracking('/track?phone=%20');
    await flush();

    expect(phoneField()).toHaveValue('(212) 555-0142');
    expect(server.lookups()).toEqual([PHONE]);
  });

  it('shows an invalid ?phone= with its error and sends no request', async () => {
    localStorage.setItem(PHONE_STORAGE_KEY, PHONE);
    const server = fakeServer({ [PHONE]: PHONE_ORDERS });

    // 555-123-4567's exchange code starts with 1, which no NANP number does.
    renderTracking('/track?phone=555-123-4567');
    await advance(30_000);

    expect(phoneField()).toHaveValue('555-123-4567');
    expect(phoneField()).toHaveAttribute('aria-invalid', 'true');
    expect(phoneField()).toHaveAccessibleDescription(
      'US and Canadian numbers only. Enter a 10-digit US or Canadian phone number.',
    );
    expect(server.fetchSpy).not.toHaveBeenCalled();
    expect(lookupLine()).not.toBeInTheDocument();
  });

  it('opens with an empty form and sends nothing when no number is saved or given', async () => {
    const server = fakeServer({ [PHONE]: PHONE_ORDERS });

    renderTracking();
    await advance(30_000);

    expect(phoneField()).toHaveValue('');
    expect(phoneField()).not.toHaveAttribute('aria-invalid');
    expect(server.fetchSpy).not.toHaveBeenCalled();
    expect(lookupLine()).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'a saved value that is not a valid number',
      setUp: () => localStorage.setItem(PHONE_STORAGE_KEY, 'not a phone number'),
    },
    {
      name: 'storage that is blocked',
      setUp: () => {
        // Saved first, so the test fails if the blocking spy has no effect.
        localStorage.setItem(PHONE_STORAGE_KEY, PHONE);
        vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        });
      },
    },
  ])('ignores $name', async ({ setUp }) => {
    setUp();
    const server = fakeServer({ [PHONE]: PHONE_ORDERS });

    renderTracking();
    await advance(30_000);

    expect(phoneField()).toHaveValue('');
    expect(phoneField()).not.toHaveAttribute('aria-invalid');
    expect(server.fetchSpy).not.toHaveBeenCalled();
  });

  it('shows a typed invalid number its error under the field and sends no request', async () => {
    const server = fakeServer({ [PHONE]: PHONE_ORDERS });
    renderTracking();

    await findOrders();

    expect(phoneField()).toHaveAttribute('aria-invalid', 'true');
    expect(phoneField()).toHaveAccessibleDescription(
      'US and Canadian numbers only. Enter your phone number.',
    );
    expect(phoneField()).toHaveFocus();

    typePhone('212-555-014');

    // Editing the number clears its error until the next submit.
    expect(phoneField()).not.toHaveAttribute('aria-invalid');
    expect(phoneField()).toHaveAccessibleDescription('US and Canadian numbers only.');

    await findOrders();

    expect(phoneField()).toHaveAccessibleDescription(
      'US and Canadian numbers only. Enter a 10-digit US or Canadian phone number.',
    );
    await advance(30_000);
    expect(server.fetchSpy).not.toHaveBeenCalled();
  });

  it('looks up a typed number without putting it in the URL', async () => {
    const server = fakeServer({ [PHONE]: PHONE_ORDERS });
    renderTracking();

    typePhone('212.555.0142');
    await findOrders();

    expect(server.lookups()).toEqual([PHONE]);
    expect(phoneField()).toHaveValue('212.555.0142');
    expect(lookupLine()).toHaveTextContent('Orders for (212) 555-0142.');
    expect(orderCard(47)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/track$/);
  });
});

describe('OrderTrackingPage: the orders', { timeout: 15_000 }, () => {
  beforeEach(() => {
    localStorage.setItem(PHONE_STORAGE_KEY, PHONE);
  });

  it("shows each order's number, time placed, items with their customizations, and stored total", async () => {
    fakeServer({ [PHONE]: PHONE_ORDERS });
    renderTracking();
    await flush();

    const card = orderCard(45);
    expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent('Order #45');
    const placedAt = within(card).getByText('Oct 15, 5:20 PM');
    expect(placedAt.tagName).toBe('TIME');
    expect(placedAt).toHaveAttribute('datetime', preparing45.createdAt);
    expect(placedAt.parentElement).toHaveTextContent(/^Ordered Oct 15, 5:20 PM$/);

    const lines = within(within(card).getByRole('list', { name: 'Items' })).getAllByRole(
      'listitem',
    );
    expect(lines.map((line) => line.textContent)).toEqual([
      '2 × MargheritaMedium, Stuffed CrustToppings: Mushrooms, Fresh Basil',
      '1 × CheeseSmall, Thin & Crispy',
    ]);
    expect(within(card).getByText('Total').parentElement).toHaveTextContent(/^Total\$56\.97$/);

    // An order from another day shows its date too.
    expect(within(orderCard(44)).getByText('Oct 14, 4:00 PM').tagName).toBe('TIME');
  });

  it('lists active orders before past ones, each newest first', async () => {
    fakeServer({ [PHONE]: PHONE_ORDERS });
    renderTracking();
    await flush();

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Active orders', 'Past orders']);
    expect(ordersIn('Active orders')).toEqual(['Order #47', 'Order #45']);
    expect(ordersIn('Past orders')).toEqual(['Order #46', 'Order #44']);
  });

  it('shows where each order is on placed, preparing, ready, delivered, and a cancelled order as cancelled', async () => {
    fakeServer({ [PHONE]: PHONE_ORDERS });
    renderTracking();
    await flush();

    expect(currentStep(47)).toBe('Placed');
    expect(currentStep(45)).toBe('Preparing');
    expect(currentStep(46)).toBe('Delivered');

    const cancelled = orderCard(44);
    expect(within(cancelled).queryByRole('list', { name: 'Order status' })).not.toBeInTheDocument();
    expect(cancelled).toHaveTextContent("Cancelled. This order won't be made.");
  });

  it('shows a status change after the next poll', async () => {
    const server = fakeServer({ [PHONE]: [placed47] });
    renderTracking();
    await flush();
    expect(currentStep(47)).toBe('Placed');

    server.move(47, 'preparing');
    await advance(9_999);
    expect(currentStep(47)).toBe('Placed');
    await advance(1);
    expect(currentStep(47)).toBe('Preparing');

    server.move(47, 'ready');
    await advance(10_000);
    expect(currentStep(47)).toBe('Ready');

    // Once handed over, the order moves to the past orders.
    server.move(47, 'delivered');
    await advance(10_000);
    expect(currentStep(47)).toBe('Delivered');
    expect(screen.queryByRole('region', { name: 'Active orders' })).not.toBeInTheDocument();
    expect(ordersIn('Past orders')).toEqual(['Order #47']);
    expect(server.lookups()).toEqual([PHONE, PHONE, PHONE, PHONE]);
  });

  it('keeps the last good orders under a stale banner while polls fail, then recovers', async () => {
    const server = fakeServer({ [PHONE]: [placed47] });
    renderTracking();
    await flush();
    // Polls at 6:00:10 PM through 6:01:00 PM succeed.
    await advance(60_000);
    expect(server.lookups()).toHaveLength(7);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // The kitchen starts the order, but the next two polls fail: one cannot
    // reach the server, the other gets the dev proxy's empty 502.
    server.move(47, 'preparing');
    server.answerNext(new TypeError('Failed to fetch'), new Response(null, { status: 502 }));

    await advance(10_000);
    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't refresh. Last updated at 6:01 PM. Retrying automatically.",
    );
    expect(currentStep(47)).toBe('Placed');
    expect(lookupLine()).toBeVisible();

    await advance(10_000);
    expect(screen.getByRole('status')).toHaveTextContent('Last updated at 6:01 PM.');
    expect(currentStep(47)).toBe('Placed');

    await advance(10_000);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(currentStep(47)).toBe('Preparing');
    expect(server.lookups()).toHaveLength(10);
  });

  it('shows the error with a working retry when the first lookup fails', async () => {
    const server = fakeServer({ [PHONE]: [placed47] });
    server.answerNext(new TypeError('Failed to fetch'));
    renderTracking();
    await flush();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't look up your orders");
    expect(alert).toHaveTextContent("Can't reach the server. Check your connection and try again.");
    expect(screen.queryByRole('listitem', { name: 'Order #47' })).not.toBeInTheDocument();

    await press(within(alert).getByRole('button', { name: 'Try again' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(currentStep(47)).toBe('Placed');
    expect(server.lookups()).toEqual([PHONE, PHONE]);
  });

  it('says when a number has no orders, and shows a new order on a later poll', async () => {
    const server = fakeServer();
    renderTracking();
    await flush();

    const empty = screen.getByRole('status');
    expect(empty).toHaveTextContent('No orders for this number');
    expect(within(empty).getByRole('link', { name: 'browse the menu' })).toHaveAttribute(
      'href',
      '/',
    );

    server.add(placedOrder(48, 0));
    await advance(10_000);

    expect(screen.queryByText('No orders for this number')).not.toBeInTheDocument();
    expect(ordersIn('Active orders')).toEqual(['Order #48']);
  });
});

describe('OrderTrackingPage: polling', { timeout: 15_000 }, () => {
  beforeEach(() => {
    localStorage.setItem(PHONE_STORAGE_KEY, PHONE);
  });

  it('stops polling on unmount, aborting the poll in flight', async () => {
    const server = fakeServer({ [PHONE]: [placed47] });
    const view = renderTracking();
    await flush();
    await advance(10_000);
    expect(server.lookups()).toEqual([PHONE, PHONE]);

    server.answerNext(deferred<Response>().promise);
    await advance(10_000);
    const calls = server.fetchSpy.mock.calls.length;
    expect(server.fetchSpy.mock.lastCall?.[1]?.signal?.aborted).toBe(false);

    view.unmount();
    await advance(60_000);

    expect(server.fetchSpy.mock.lastCall?.[1]?.signal?.aborted).toBe(true);
    expect(server.fetchSpy).toHaveBeenCalledTimes(calls);
  });

  it('restarts polling for a new number, and polls the old one no more', async () => {
    const server = fakeServer({ [PHONE]: [placed47], [OTHER_PHONE]: [otherPlaced50] });
    renderTracking();
    await flush();
    await advance(4_000);

    typePhone('(312) 555-0199');
    await findOrders();

    expect(server.lookups()).toEqual([PHONE, OTHER_PHONE]);
    expect(lookupLine()).toHaveTextContent('Orders for (312) 555-0199.');
    expect(ordersIn('Active orders')).toEqual(['Order #50']);

    // The old number's next poll was due 6 s from now; the new number polls
    // every 10 s from its own first lookup.
    await advance(9_999);
    expect(server.lookups()).toEqual([PHONE, OTHER_PHONE]);
    await advance(1);
    expect(server.lookups()).toEqual([PHONE, OTHER_PHONE, OTHER_PHONE]);
  });

  it('never shows a slow answer for the old number under the new one', async () => {
    const server = fakeServer({ [PHONE]: [placed47], [OTHER_PHONE]: [otherPlaced50] });
    renderTracking();
    await flush();
    const slow = deferred<Response>();
    server.answerNext(slow.promise);
    await advance(10_000);

    typePhone('(312) 555-0199');
    await findOrders();
    expect(ordersIn('Active orders')).toEqual(['Order #50']);

    await act(async () => {
      slow.resolve(jsonResponse([moved(placed47, 'preparing')]));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(lookupLine()).toHaveTextContent('Orders for (312) 555-0199.');
    expect(ordersIn('Active orders')).toEqual(['Order #50']);
    // The old number's slow poll was aborted, so it is not counted.
    expect(server.lookups()).toEqual([PHONE, OTHER_PHONE]);
  });

  it('looks the same number up again at once when it is submitted again', async () => {
    const server = fakeServer({ [PHONE]: [placed47] });
    renderTracking();
    await flush();
    await advance(4_000);

    await findOrders();
    expect(server.lookups()).toEqual([PHONE, PHONE]);

    // Polling now counts from the new lookup at 6:00:04 PM.
    await advance(6_000);
    expect(server.lookups()).toHaveLength(2);
    await advance(4_000);
    expect(server.lookups()).toHaveLength(3);
  });

  it('stops looking up the previous number after an invalid submit', async () => {
    const server = fakeServer({ [PHONE]: [placed47] });
    renderTracking();
    await flush();

    typePhone('212-555-01422');
    await findOrders();

    expect(phoneField()).toHaveAttribute('aria-invalid', 'true');
    expect(lookupLine()).not.toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: 'Order #47' })).not.toBeInTheDocument();
    await advance(30_000);
    expect(server.lookups()).toEqual([PHONE]);
  });
});
