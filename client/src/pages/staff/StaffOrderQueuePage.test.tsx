import type { OrderStatus } from '@fired-up-pizza/shared';
import { canTransition, LIVE_ORDER_STATUSES } from '@fired-up-pizza/shared/order-status';
import type { OrderDetails, OrderDetailsItem } from '@fired-up-pizza/shared/orders-api';
import { act, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, renderWithProviders } from '../../test/render';
import { StaffOrderQueuePage } from './StaffOrderQueuePage';

// Every test runs on Vitest's fake clock, so polls, order ages, and fetch
// answers move only when the test says so, and nothing waits on real time.
// The page renders in StrictMode, as main.tsx renders it. Its development
// double mount starts one extra poll and aborts it at once; the fake server
// treats that request as a real aborted fetch, and the counts below skip it.

/** 6:00 PM local time, when every test starts. */
const START = new Date(2026, 9, 15, 18, 0, 0);

const QUEUE = '/api/staff/orders';
const STATUS_PATH = /^\/api\/staff\/orders\/(\d+)\/status$/;

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
  fields: Partial<Pick<OrderDetails, 'phoneNumber' | 'notes' | 'totalCents' | 'items'>> = {},
): OrderDetails {
  const createdAt = minutesAgo(minutes);
  return {
    id,
    phoneNumber: '+12125550100',
    status: 'placed',
    totalCents: 1299,
    notes: '',
    createdAt,
    updatedAt: createdAt,
    items: [item(id * 10, 1, 'Pepperoni', 'Medium', 'Hand-Tossed')],
    statusEvents: [{ id: id * 10, fromStatus: null, toStatus: 'placed', changedAt: createdAt }],
    ...fields,
  };
}

/** The order once the server moved it to `status`: one more status event (ADR 0004 rule 4). */
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

const ready9 = moved(
  moved(placedOrder(9, 21, { phoneNumber: '+13125550111' }), 'preparing', minutesAgo(18)),
  'ready',
  minutesAgo(2),
);
const preparing10 = moved(placedOrder(10, 15), 'preparing', minutesAgo(10));
const preparing11 = moved(placedOrder(11, 12), 'preparing', minutesAgo(8));
const placed12 = placedOrder(12, 7, {
  phoneNumber: '+12125550142',
  // Notes keep the customer's line break; the page shows it as typed.
  notes: 'Ring the bell twice, please.\nNo plastic cutlery.',
  totalCents: 4797,
  items: [
    item(121, 2, 'Margherita', 'Large', 'Thin & Crispy', ['Mushrooms', 'Fresh Basil']),
    item(122, 1, 'Cheese', 'Small', 'Hand-Tossed'),
  ],
});
const placed13 = placedOrder(13, 3);

/** The live queue as GET /api/staff/orders sends it: oldest first. */
const LIVE_QUEUE = [ready9, preparing10, preparing11, placed12, placed13];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return jsonResponse({ error: { code, message, details } }, status);
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

/** The JSON a request sent; the client's http helper sends bodies as JSON text. */
function jsonBody(init: RequestInit | undefined) {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}

function isLive(status: OrderStatus): boolean {
  return (LIVE_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

/**
 * A stand-in for the API that keeps its own orders, like the real server:
 * - GET /api/staff/orders lists the live ones, in the order they were added.
 * - PATCH /api/staff/orders/:id/status moves an order when the shared
 *   transition table allows it, and answers 409 ILLEGAL_STATUS_TRANSITION
 *   with { currentStatus, requestedStatus } when it does not.
 * A test can queue other answers for the next requests, hold the next PATCH,
 * or change an order "elsewhere", as another staff member's click would.
 * A request aborted before it is answered gets an AbortError and uses up no
 * queued answer. Any other request fails as if the server were down.
 */
function fakeServer(initialOrders: readonly OrderDetails[]) {
  let orders = [...initialOrders];
  const nextGets: Answer[] = [];
  const nextPatches: Answer[] = [];
  let heldPatch: Deferred<void> | null = null;

  function patch(orderId: number, status: OrderStatus): Response {
    const order = orders.find((candidate) => candidate.id === orderId);
    if (order === undefined) {
      return errorResponse(404, 'NOT_FOUND', `Order ${orderId} was not found.`);
    }
    if (!canTransition(order.status, status)) {
      return errorResponse(
        409,
        'ILLEGAL_STATUS_TRANSITION',
        `Order ${orderId} cannot move from ${order.status} to ${status}.`,
        { currentStatus: order.status, requestedStatus: status },
      );
    }
    const updated = moved(order, status);
    orders = orders.map((candidate) => (candidate.id === orderId ? updated : candidate));
    return jsonResponse(updated);
  }

  function liveQueue(): Response {
    return jsonResponse(orders.filter((order) => isLive(order.status)));
  }

  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET';
    const path = typeof input === 'string' ? input : '';
    await Promise.resolve();
    if (init?.signal?.aborted) {
      throw new DOMException('This operation was aborted', 'AbortError');
    }
    let answer: Answer | undefined;
    if (method === 'GET' && path === QUEUE) {
      answer = nextGets.shift() ?? liveQueue();
    } else if (method === 'PATCH' && STATUS_PATH.test(path)) {
      answer = nextPatches.shift();
      if (answer === undefined) {
        const hold = heldPatch;
        heldPatch = null;
        await hold?.promise;
        const { status } = jsonBody(init);
        answer = patch(Number(STATUS_PATH.exec(path)?.[1]), status);
      }
    }
    if (answer === undefined || answer instanceof Error) {
      throw answer ?? new TypeError('Failed to fetch');
    }
    return answer;
  });

  return {
    fetchSpy,
    /** The response GET /api/staff/orders would get now. */
    liveQueue,
    /** Answers the next GETs with these instead of the live queue. */
    answerNextGets(...answers: Answer[]) {
      nextGets.push(...answers);
    },
    /** Answers the next PATCHes with these instead of handling them. */
    answerNextPatches(...answers: Answer[]) {
      nextPatches.push(...answers);
    },
    /** Makes the next PATCH wait. Calling the returned function lets the server handle it. */
    holdNextPatch(): () => void {
      const hold = deferred<void>();
      heldPatch = hold;
      return () => hold.resolve();
    },
    /** Moves an order as another staff member's click would. The page sees it on its next poll. */
    changeElsewhere(orderId: number, status: OrderStatus) {
      orders = orders.map((order) => (order.id === orderId ? moved(order, status) : order));
    },
    add(order: OrderDetails) {
      orders.push(order);
    },
  };
}

type FetchSpy = ReturnType<typeof fakeServer>['fetchSpy'];

/** The requests the page sent and did not abort: [path, init] pairs. */
function requestsSent(fetchSpy: FetchSpy) {
  return fetchSpy.mock.calls.filter(([, init]) => init?.signal?.aborted !== true);
}

function queueRequestCount(fetchSpy: FetchSpy): number {
  return requestsSent(fetchSpy).filter(([input, init]) => input === QUEUE && init?.method === 'GET')
    .length;
}

/** The JSON bodies the page sent to change one order's status, in order. */
function statusChangesSent(fetchSpy: FetchSpy, orderId: number): unknown[] {
  return requestsSent(fetchSpy)
    .filter(([input, init]) => input === `${QUEUE}/${orderId}/status` && init?.method === 'PATCH')
    .map(([, init]) => jsonBody(init));
}

/** Lets fetch answers, and the renders they cause, run without moving the clock. */
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Moves the clock on, running the polls and clock ticks that fall due on the way. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Presses a button as a mouse does, focusing it first, then lets what it sends settle. */
async function press(button: HTMLElement) {
  await act(async () => {
    button.focus();
    button.click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Renders the page as main.tsx does, in StrictMode, and lets its first poll answer. */
async function renderQueue() {
  renderWithProviders(
    <StrictMode>
      <StaffOrderQueuePage />
    </StrictMode>,
  );
  await flush();
}

type SectionTitle = 'Placed' | 'Preparing' | 'Ready';

function section(title: SectionTitle): HTMLElement {
  return screen.getByRole('region', { name: title });
}

/** The order numbers in one section, top to bottom. */
function ordersIn(title: SectionTitle): string[] {
  return within(section(title))
    .queryAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
}

function card(orderId: number): HTMLElement {
  return screen.getByRole('listitem', { name: `Order #${orderId}` });
}

function queryCard(orderId: number): HTMLElement | null {
  return screen.queryByRole('listitem', { name: `Order #${orderId}` });
}

/** The card's button with this accessible name, e.g. "Start preparing order #12". */
function button(orderId: number, name: string): HTMLElement {
  return within(card(orderId)).getByRole('button', { name });
}

/** Every button on the card, by accessible name. Each name's visible part is followed by the order number. */
function buttonNames(orderId: number): string[] {
  return within(card(orderId))
    .getAllByRole('button')
    .map((element) => element.textContent);
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('StaffOrderQueuePage views', { timeout: 15_000 }, () => {
  it('shows a loading state until the first poll answers', async () => {
    const server = fakeServer(LIVE_QUEUE);
    const firstPoll = deferred<Response>();
    server.answerNextGets(firstPoll.promise);

    await renderQueue();

    expect(screen.getByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument();
    expect(screen.getByText('Loading orders…')).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    firstPoll.resolve(jsonResponse(LIVE_QUEUE));
    await flush();

    expect(screen.queryByText('Loading orders…')).not.toBeInTheDocument();
    expect(ordersIn('Placed')).toEqual(['Order #12', 'Order #13']);
  });

  it('groups live orders into Placed, Preparing, and Ready sections, oldest first', async () => {
    fakeServer(LIVE_QUEUE);
    await renderQueue();

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Placed', 'Preparing', 'Ready']);
    expect(ordersIn('Placed')).toEqual(['Order #12', 'Order #13']);
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11']);
    expect(ordersIn('Ready')).toEqual(['Order #9']);
  });

  it("shows each order's number, age, phone number, total, lines, and notes", async () => {
    fakeServer(LIVE_QUEUE);
    await renderQueue();

    const order12 = card(12);
    expect(within(order12).getByRole('heading', { level: 3 })).toHaveTextContent('Order #12');
    expect(within(order12).getByText('7 min ago')).toHaveAttribute('datetime', placed12.createdAt);
    expect(within(order12).getByText('(212) 555-0142')).toBeInTheDocument();
    expect(within(order12).getByText('$47.97')).toBeInTheDocument();

    const [margherita, cheese, ...others] = within(order12).getAllByRole('listitem');
    expect(others).toEqual([]);
    expect(within(margherita!).getByText('2 × Margherita')).toBeInTheDocument();
    expect(within(margherita!).getByText('Large, Thin & Crispy')).toBeInTheDocument();
    expect(within(margherita!).getByText('Toppings: Mushrooms, Fresh Basil')).toBeInTheDocument();
    expect(within(cheese!).getByText('1 × Cheese')).toBeInTheDocument();
    expect(within(cheese!).getByText('Small, Hand-Tossed')).toBeInTheDocument();
    expect(within(cheese!).getByText('No extra toppings')).toBeInTheDocument();

    expect(within(order12).getByText('Notes')).toBeInTheDocument();
    const notes = within(order12).getByText(/^Ring the bell twice/);
    expect(notes.textContent).toBe('Ring the bell twice, please.\nNo plastic cutlery.');

    expect(within(card(9)).getByText('(312) 555-0111')).toBeInTheDocument();
    expect(within(card(13)).getByText('3 min ago')).toBeInTheDocument();
    expect(within(card(13)).queryByText('Notes')).not.toBeInTheDocument();
  });

  it('offers the next step for each status, and Cancel only while an order can be cancelled', async () => {
    fakeServer(LIVE_QUEUE);
    await renderQueue();

    expect(buttonNames(12)).toEqual(['Start preparing order #12', 'Cancel order #12']);
    expect(buttonNames(10)).toEqual(['Mark ready order #10', 'Cancel order #10']);
    expect(buttonNames(9)).toEqual(['Mark delivered order #9']);
  });

  it('says there are no live orders when the queue is empty', async () => {
    fakeServer([]);
    await renderQueue();

    expect(screen.getByText('No live orders')).toBeInTheDocument();
    expect(screen.getByText('New orders show up here on their own.')).toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the first poll fails, and loads the queue on retry', async () => {
    const server = fakeServer(LIVE_QUEUE);
    const retry = deferred<Response>();
    server.answerNextGets(new TypeError('Failed to fetch'), retry.promise);
    await renderQueue();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the order queue");
    expect(alert).toHaveTextContent("Can't reach the server. Check your connection and try again.");
    expect(screen.queryByRole('region')).not.toBeInTheDocument();

    await press(within(alert).getByRole('button', { name: 'Try again' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Loading orders…')).toBeInTheDocument();

    retry.resolve(jsonResponse(LIVE_QUEUE));
    await flush();

    expect(ordersIn('Placed')).toEqual(['Order #12', 'Order #13']);
    expect(queueRequestCount(server.fetchSpy)).toBe(2);
  });

  it('keeps the last good queue under a stale banner while polls fail, then clears it', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    // The polls at 10 through 60 seconds all fail.
    server.answerNextGets(
      errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'),
      ...Array.from({ length: 5 }, () => new TypeError('Failed to fetch')),
    );

    await advance(10_000);

    const banner = screen.getByText("Couldn't refresh.").parentElement;
    expect(banner).toHaveTextContent(
      "Couldn't refresh. Last updated at 6:00 PM. Retrying automatically.",
    );
    expect(ordersIn('Placed')).toEqual(['Order #12', 'Order #13']);
    expect(button(12, 'Start preparing order #12')).toBeEnabled();

    // Ages keep counting while the queue is stale: they come from the clock.
    await advance(50_000);
    expect(screen.getByText("Couldn't refresh.")).toBeInTheDocument();
    expect(within(card(13)).getByText('4 min ago')).toBeInTheDocument();

    server.changeElsewhere(13, 'preparing');
    await advance(10_000);

    expect(screen.queryByText("Couldn't refresh.")).not.toBeInTheDocument();
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11', 'Order #13']);
    expect(queueRequestCount(server.fetchSpy)).toBe(8);
  });

  it('renders at /staff/orders inside the staff layout', async () => {
    fakeServer(LIVE_QUEUE);
    renderApp('/staff/orders');
    await flush();

    expect(screen.getByRole('navigation', { name: 'Staff' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Order queue' })).toBeInTheDocument();
    expect(ordersIn('Ready')).toEqual(['Order #9']);
  });
});

describe('StaffOrderQueuePage polling', { timeout: 15_000 }, () => {
  it('polls the live queue every 10 seconds and shows what changed', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    expect(queueRequestCount(server.fetchSpy)).toBe(1);

    // Meanwhile, on other screens: order 9 goes out, order 12 starts
    // preparing, and order 14 comes in.
    server.changeElsewhere(9, 'delivered');
    server.changeElsewhere(12, 'preparing');
    server.add(placedOrder(14, 0));

    await advance(9_999);
    expect(queueRequestCount(server.fetchSpy)).toBe(1);
    expect(ordersIn('Placed')).toEqual(['Order #12', 'Order #13']);

    await advance(1);
    expect(queueRequestCount(server.fetchSpy)).toBe(2);
    expect(ordersIn('Placed')).toEqual(['Order #13', 'Order #14']);
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11', 'Order #12']);
    expect(ordersIn('Ready')).toEqual([]);
    expect(within(section('Ready')).getByText('Nothing waiting to go out.')).toBeInTheDocument();
    expect(within(card(14)).getByText('Just now')).toBeInTheDocument();

    await advance(10_000);
    expect(queueRequestCount(server.fetchSpy)).toBe(3);
    // Every poll asks for the default live queue, never for terminal statuses.
    expect(requestsSent(server.fetchSpy).map(([input]) => input)).toEqual([QUEUE, QUEUE, QUEUE]);
  });

  it('counts order ages up between polls', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    expect(within(card(13)).getByText('3 min ago')).toBeInTheDocument();

    await advance(59_999);
    expect(within(card(13)).getByText('3 min ago')).toBeInTheDocument();

    await advance(15_001);
    expect(within(card(13)).getByText('4 min ago')).toBeInTheDocument();
    expect(within(card(9)).getByText('22 min ago')).toBeInTheDocument();
    expect(queueRequestCount(server.fetchSpy)).toBe(8);
  });
});

describe('StaffOrderQueuePage status changes', { timeout: 15_000 }, () => {
  it('moves an order a step forward: the card waits, then shows in its new section, and the queue polls again', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    const release = server.holdNextPatch();

    await press(button(12, 'Start preparing order #12'));

    expect(statusChangesSent(server.fetchSpy, 12)).toEqual([{ status: 'preparing' }]);
    expect(button(12, 'Saving… order #12')).toBeDisabled();
    expect(button(12, 'Cancel order #12')).toBeDisabled();
    expect(button(13, 'Start preparing order #13')).toBeEnabled();
    expect(button(10, 'Mark ready order #10')).toBeEnabled();
    expect(queueRequestCount(server.fetchSpy)).toBe(1);

    release();
    await flush();

    expect(ordersIn('Placed')).toEqual(['Order #13']);
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11', 'Order #12']);
    expect(buttonNames(12)).toEqual(['Mark ready order #12', 'Cancel order #12']);
    expect(screen.getByText('Order #12 is now preparing.')).toBeInTheDocument();
    expect(queueRequestCount(server.fetchSpy)).toBe(2);
    // The button that was pressed is gone, so focus moves to the order's card.
    expect(card(12)).toHaveFocus();
  });

  it('walks an order through to delivered, when it leaves the queue', async () => {
    const server = fakeServer([placed12]);
    await renderQueue();

    await press(button(12, 'Start preparing order #12'));
    expect(ordersIn('Preparing')).toEqual(['Order #12']);

    await press(button(12, 'Mark ready order #12'));
    expect(ordersIn('Ready')).toEqual(['Order #12']);
    expect(screen.getByText('Order #12 is now ready.')).toBeInTheDocument();

    // The queue is empty as soon as the change is saved, before its refresh answers.
    const refresh = deferred<Response>();
    server.answerNextGets(refresh.promise);
    await press(button(12, 'Mark delivered order #12'));
    expect(queryCard(12)).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByText('No live orders')).toBeInTheDocument();
    expect(screen.getByText('Order #12 is now delivered.')).toHaveFocus();

    refresh.resolve(server.liveQueue());
    await flush();
    expect(screen.getByText('No live orders')).toBeInTheDocument();

    expect(statusChangesSent(server.fetchSpy, 12)).toEqual([
      { status: 'preparing' },
      { status: 'ready' },
      { status: 'delivered' },
    ]);
  });

  it('keeps a saved change when a poll that started before it answers with the old order', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    const earlierPoll = deferred<Response>();
    const laterPoll = deferred<Response>();
    server.answerNextGets(earlierPoll.promise, laterPoll.promise);
    await advance(10_000);

    await press(button(12, 'Start preparing order #12'));
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11', 'Order #12']);
    // The refresh waits for the poll in flight, so polls never overlap.
    expect(queueRequestCount(server.fetchSpy)).toBe(2);

    // The poll from before the change still lists order 12 as placed.
    earlierPoll.resolve(jsonResponse(LIVE_QUEUE));
    await flush();

    expect(queueRequestCount(server.fetchSpy)).toBe(3);
    expect(ordersIn('Placed')).toEqual(['Order #13']);
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11', 'Order #12']);
    expect(buttonNames(12)).toEqual(['Mark ready order #12', 'Cancel order #12']);

    // The refresh the change asked for lists it too.
    laterPoll.resolve(server.liveQueue());
    await flush();
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11', 'Order #12']);

    // Later changes made elsewhere still show.
    server.changeElsewhere(12, 'ready');
    await advance(10_000);
    expect(ordersIn('Ready')).toEqual(['Order #9', 'Order #12']);
  });

  it('asks before cancelling, and Keep order sends nothing', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();

    await press(button(12, 'Cancel order #12'));

    const question = within(card(12)).getByRole('group', {
      name: "Cancel order #12? This can't be undone.",
    });
    expect(within(question).getByRole('button', { name: 'Keep order #12' })).toHaveFocus();
    expect(buttonNames(12)).toEqual(['Yes, cancel order #12', 'Keep order #12']);

    await press(within(question).getByRole('button', { name: 'Keep order #12' }));

    expect(within(card(12)).queryByRole('group')).not.toBeInTheDocument();
    expect(button(12, 'Cancel order #12')).toHaveFocus();
    expect(buttonNames(12)).toEqual(['Start preparing order #12', 'Cancel order #12']);
    expect(statusChangesSent(server.fetchSpy, 12)).toEqual([]);
  });

  it('cancels an order once staff confirm, and the order leaves the queue', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    const release = server.holdNextPatch();

    await press(button(10, 'Cancel order #10'));
    await press(button(10, 'Yes, cancel order #10'));

    expect(statusChangesSent(server.fetchSpy, 10)).toEqual([{ status: 'cancelled' }]);
    expect(buttonNames(10)).toEqual(['Mark ready order #10', 'Cancelling… #10']);
    expect(button(10, 'Mark ready order #10')).toBeDisabled();
    expect(button(10, 'Cancelling… #10')).toBeDisabled();

    release();
    await flush();

    expect(queryCard(10)).not.toBeInTheDocument();
    expect(ordersIn('Preparing')).toEqual(['Order #11']);
    expect(screen.getByText('Order #10 is now cancelled.')).toHaveFocus();
  });

  it('drops the question when the order changes before staff answer it', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    await press(button(12, 'Cancel order #12'));

    server.changeElsewhere(12, 'preparing');
    await advance(10_000);

    expect(within(card(12)).queryByRole('group')).not.toBeInTheDocument();
    expect(buttonNames(12)).toEqual(['Mark ready order #12', 'Cancel order #12']);
  });

  it.each([
    {
      elsewhere: 'preparing',
      message:
        "Order #12 changed elsewhere and is now preparing, so it wasn't updated. Refreshing the queue.",
      sectionNow: 'Preparing',
    },
    {
      elsewhere: 'cancelled',
      message:
        "Order #12 changed elsewhere and is now cancelled, so it wasn't updated. Refreshing the queue.",
      sectionNow: null,
    },
  ] satisfies { elsewhere: OrderStatus; message: string; sectionNow: SectionTitle | null }[])(
    'says when an order was already $elsewhere elsewhere (409), and polls to show it',
    async ({ elsewhere, message, sectionNow }) => {
      const server = fakeServer(LIVE_QUEUE);
      await renderQueue();
      server.changeElsewhere(12, elsewhere);

      await press(button(12, 'Start preparing order #12'));

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(message);
      expect(alert).toHaveFocus();
      expect(queueRequestCount(server.fetchSpy)).toBe(2);
      expect(ordersIn('Placed')).toEqual(['Order #13']);
      if (sectionNow === null) {
        expect(queryCard(12)).not.toBeInTheDocument();
      } else {
        expect(ordersIn(sectionNow)).toContain('Order #12');
      }
      expect(screen.queryByText(/is now preparing\.$/)).not.toBeInTheDocument();
    },
  );

  it('says the order changed elsewhere even when the 409 does not say what it is now', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    server.answerNextPatches(
      errorResponse(409, 'ILLEGAL_STATUS_TRANSITION', 'Order 12 cannot move.', { stale: true }),
    );

    await press(button(12, 'Start preparing order #12'));

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Order #12 changed elsewhere, so it wasn't updated. Refreshing the queue.",
    );
    expect(queueRequestCount(server.fetchSpy)).toBe(2);
  });

  it.each([
    {
      name: 'a server error',
      answer: () => errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'),
      message: "Couldn't mark order #12 as preparing. Something went wrong. Please try again.",
    },
    {
      name: 'no connection',
      answer: () => new TypeError('Failed to fetch'),
      message:
        "Couldn't mark order #12 as preparing. Can't reach the server. Check your connection and try again.",
    },
  ])('shows $name on the card with a retry, without refreshing', async ({ answer, message }) => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    server.answerNextPatches(answer());

    await press(button(12, 'Start preparing order #12'));

    const alert = within(card(12)).getByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.getAllByRole('alert')).toEqual([alert]);
    expect(queueRequestCount(server.fetchSpy)).toBe(1);
    expect(ordersIn('Placed')).toEqual(['Order #12', 'Order #13']);
    expect(button(12, 'Start preparing order #12')).toBeEnabled();

    await press(within(alert).getByRole('button', { name: 'Try again for order #12' }));

    expect(statusChangesSent(server.fetchSpy, 12)).toEqual([
      { status: 'preparing' },
      { status: 'preparing' },
    ]);
    expect(ordersIn('Preparing')).toEqual(['Order #10', 'Order #11', 'Order #12']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Order #12 is now preparing.')).toBeInTheDocument();
  });

  it('retries a failed cancel without asking again', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    server.answerNextPatches(new TypeError('Failed to fetch'));

    await press(button(12, 'Cancel order #12'));
    await press(button(12, 'Yes, cancel order #12'));

    const alert = within(card(12)).getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't mark order #12 as cancelled.");
    // The pressed button went away with the question, so focus moved to the card.
    expect(card(12)).toHaveFocus();

    await press(within(alert).getByRole('button', { name: 'Try again for order #12' }));

    expect(statusChangesSent(server.fetchSpy, 12)).toEqual([
      { status: 'cancelled' },
      { status: 'cancelled' },
    ]);
    expect(queryCard(12)).not.toBeInTheDocument();
  });

  it('disables the cancel question too while a retry is in flight', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    server.answerNextPatches(new TypeError('Failed to fetch'));
    await press(button(12, 'Start preparing order #12'));
    await press(button(12, 'Cancel order #12'));
    const release = server.holdNextPatch();

    await press(button(12, 'Try again for order #12'));

    expect(buttonNames(12)).toEqual(['Yes, cancel order #12', 'Keep order #12']);
    expect(button(12, 'Yes, cancel order #12')).toBeDisabled();
    expect(button(12, 'Keep order #12')).toBeDisabled();

    release();
    await flush();

    // The order moved on, so the question about cancelling it as placed is gone.
    expect(buttonNames(12)).toEqual(['Mark ready order #12', 'Cancel order #12']);
    expect(statusChangesSent(server.fetchSpy, 12)).toEqual([
      { status: 'preparing' },
      { status: 'preparing' },
    ]);
  });

  it('drops a failure once the order changes elsewhere', async () => {
    const server = fakeServer(LIVE_QUEUE);
    await renderQueue();
    server.answerNextPatches(new TypeError('Failed to fetch'));
    await press(button(12, 'Start preparing order #12'));
    expect(within(card(12)).getByRole('alert')).toBeInTheDocument();

    server.changeElsewhere(12, 'preparing');
    await advance(10_000);

    expect(ordersIn('Preparing')).toContain('Order #12');
    expect(within(card(12)).queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    { settles: 'is saved', changedElsewhere: false },
    { settles: 'gets a 409', changedElsewhere: true },
  ])(
    'leaves focus alone when staff moved on to another order before a change $settles',
    async ({ changedElsewhere }) => {
      const server = fakeServer(LIVE_QUEUE);
      await renderQueue();
      if (changedElsewhere) {
        server.changeElsewhere(12, 'preparing');
      }
      const release = server.holdNextPatch();

      await press(button(12, 'Start preparing order #12'));
      const other = button(13, 'Start preparing order #13');
      act(() => {
        other.focus();
      });

      release();
      await flush();

      expect(ordersIn('Preparing')).toContain('Order #12');
      expect(other).toHaveFocus();
    },
  );
});
