import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import { MAX_QUANTITY_PER_ITEM } from '@fired-up-pizza/shared/pricing';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CART_STORAGE_KEY, type CartLineItem } from '../../context/CartContext';
import { renderApp } from '../../test/render';

// The key and format order tracking reads the phone number from (fup-bq3.2).
const PHONE_KEY = 'fired-up-pizza.phone';

// A submit, its response, and the render after it can take more than Testing
// Library's default 1 s on a busy machine, so the waits here allow 5 s, and
// each test 15 s.
const WAIT = { timeout: 5000 };

/** round(1099 × 1.25) = 1374, + 200 crust + 150 + 100 toppings = 1824 cents each. */
const margheritaLine: CartLineItem = {
  lineId: 'line-1',
  menuItemId: 2,
  sizeId: 2,
  crustId: 3,
  toppingIds: [7, 12],
  quantity: 2,
  display: {
    menuItemName: 'Margherita',
    sizeName: 'Medium',
    crustName: 'Stuffed Crust',
    toppingNames: ['Mushrooms', 'Fresh Basil'],
    unitPriceCents: 1824,
  },
};

/** round(1299 × 1.5) = 1949 cents each, nothing added. */
const pepperoniLine: CartLineItem = {
  lineId: 'line-2',
  menuItemId: 3,
  sizeId: 3,
  crustId: 1,
  toppingIds: [],
  quantity: 1,
  display: {
    menuItemName: 'Pepperoni',
    sizeName: 'Large',
    crustName: 'Hand-Tossed',
    toppingNames: [],
    unitPriceCents: 1949,
  },
};

const placedAt = new Date(2026, 9, 15, 18, 5).toISOString();

/**
 * What the server stores for the cart above. Mushrooms went up to 200 cents
 * after the Margherita was added, so its snapshot is 1874 each and the total
 * 5697: the cart's estimate of 5597 is no longer right.
 */
const order: OrderDetails = {
  id: 42,
  phoneNumber: '+12125550142',
  status: 'placed',
  totalCents: 5697,
  notes: 'Ring the bell',
  createdAt: placedAt,
  updatedAt: placedAt,
  items: [
    {
      id: 57,
      menuItemId: 2,
      sizeId: 2,
      crustId: 3,
      quantity: 2,
      unitPriceCents: 1874,
      menuItemName: 'Margherita',
      sizeName: 'Medium',
      crustName: 'Stuffed Crust',
      toppings: [
        { toppingId: 7, priceCents: 200, toppingName: 'Mushrooms' },
        { toppingId: 12, priceCents: 100, toppingName: 'Fresh Basil' },
      ],
    },
    {
      id: 58,
      menuItemId: 3,
      sizeId: 3,
      crustId: 1,
      quantity: 1,
      unitPriceCents: 1949,
      menuItemName: 'Pepperoni',
      sizeName: 'Large',
      crustName: 'Hand-Tossed',
      toppings: [],
    },
  ],
  statusEvents: [{ id: 90, fromStatus: null, toStatus: 'placed', changedAt: placedAt }],
};

/** The items PlaceOrderRequest carries for the cart above: ids and quantities only. */
const sentItems = [
  { menuItemId: 2, sizeId: 2, crustId: 3, toppingIds: [7, 12], quantity: 2 },
  { menuItemId: 3, sizeId: 3, crustId: 1, toppingIds: [], quantity: 1 },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return jsonResponse({ error: { code, message, details } }, status);
}

function validationError(issues: { path: string; message: string }[]): Response {
  return errorResponse(400, 'VALIDATION_ERROR', 'Request validation failed', { issues });
}

function itemUnavailable(issues: { path: string; message: string }[]): Response {
  return errorResponse(
    422,
    'ITEM_UNAVAILABLE',
    'Some of the items in this order are not available',
    {
      issues,
    },
  );
}

/** A response the test sends when it chooses. */
function pendingResponse() {
  let send!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    send = resolve;
  });
  return { promise, send };
}

/** Answers each request with the next answer; a request with none left fails as if offline. */
function fakeApi(...answers: (Response | Promise<Response>)[]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    const answer = answers.shift();
    return answer === undefined
      ? Promise.reject(new TypeError('Failed to fetch'))
      : Promise.resolve(answer);
  });
}

type FetchSpy = ReturnType<typeof fakeApi>;

/** The JSON bodies sent to POST /api/orders, in order. Fails on any other request. */
function ordersSent(fetchSpy: FetchSpy): unknown[] {
  return fetchSpy.mock.calls.map(([input, init]) => {
    expect(input).toBe('/api/orders');
    expect(init?.method).toBe('POST');
    return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  });
}

function seedCart(lines: CartLineItem[]) {
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
}

function storedCart(): unknown {
  const stored = localStorage.getItem(CART_STORAGE_KEY);
  return stored === null ? null : JSON.parse(stored);
}

/** Opens /cart with these lines in the cart. */
function renderCart(lines: CartLineItem[] = [margheritaLine, pepperoniLine]) {
  seedCart(lines);
  renderApp('/cart');
}

function cartLine(name: string): HTMLElement {
  const lines = screen.getByRole('list', { name: 'Your pizzas' });
  return within(lines).getByRole('listitem', { name });
}

/** The text of each paragraph in an element, top to bottom. */
function paragraphs(element: HTMLElement): (string | null)[] {
  return Array.from(element.querySelectorAll('p'), (paragraph) => paragraph.textContent);
}

function estimatedTotal(): string | null {
  return screen.getByText('Estimated total').parentElement?.textContent ?? null;
}

function phoneField(): HTMLElement {
  return screen.getByLabelText('Phone number');
}

function notesField(): HTMLElement {
  return screen.getByLabelText('Notes for the kitchen (optional)');
}

function placeOrderButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Place order' });
}

/** Fills in the checkout form and presses Place order. */
async function checkOut(user: UserEvent, { phone = '(212) 555-0142', notes = '' } = {}) {
  if (phone !== '') {
    await user.click(phoneField());
    await user.paste(phone);
  }
  if (notes !== '') {
    await user.click(notesField());
    await user.paste(notes);
  }
  await user.click(placeOrderButton());
}

/** The error shown under a field, through the field's own description. */
function fieldError(field: HTMLElement): string | null {
  const ids = field.getAttribute('aria-describedby')?.split(' ') ?? [];
  const errorId = ids.find((id) => id.endsWith('-error'));
  return errorId === undefined ? null : (document.getElementById(errorId)?.textContent ?? null);
}

async function expectConfirmation() {
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Order #42' }, WAIT),
  ).toBeInTheDocument();
}

/** Expects the cart to hold its two lines, on screen and in storage. */
function expectCartKept() {
  expect(
    within(screen.getByRole('list', { name: 'Your pizzas' })).getAllByRole('listitem'),
  ).toHaveLength(2);
  expect(storedCart()).toEqual([margheritaLine, pepperoniLine]);
  expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toBeInTheDocument();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CartPage', { timeout: 15_000 }, () => {
  describe('with an empty cart', () => {
    it('says the cart is empty and links back to the menu', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      renderApp('/cart');

      expect(screen.getByRole('heading', { level: 1, name: 'Your cart' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Your cart is empty');
      expect(screen.getByRole('link', { name: 'Browse the menu' })).toHaveAttribute('href', '/');
      expect(screen.queryByRole('form', { name: 'Checkout' })).not.toBeInTheDocument();
      expect(screen.queryByRole('list', { name: 'Your pizzas' })).not.toBeInTheDocument();
      // The cart page loads nothing: the cart is all it shows.
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('lines', () => {
    it('lists each line with its customizations, estimated prices, and quantity', () => {
      renderCart();

      const lines = within(screen.getByRole('list', { name: 'Your pizzas' })).getAllByRole(
        'listitem',
      );
      expect(lines).toHaveLength(2);
      expect(paragraphs(cartLine('Margherita'))).toEqual([
        'Margherita',
        'Medium, Stuffed Crust',
        'Toppings: Mushrooms, Fresh Basil',
        '$18.24 each',
        '$36.48',
      ]);
      expect(paragraphs(cartLine('Pepperoni'))).toEqual([
        'Pepperoni',
        'Large, Hand-Tossed',
        '$19.49 each',
        '$19.49',
      ]);
      expect(
        within(cartLine('Margherita')).getByRole('status', { name: 'Quantity of Margherita' }),
      ).toHaveTextContent('2');
      expect(
        within(cartLine('Pepperoni')).getByRole('status', { name: 'Quantity of Pepperoni' }),
      ).toHaveTextContent('1');
    });

    it('shows the estimated total and says the confirmation has the final one', () => {
      renderCart();

      expect(estimatedTotal()).toBe('Estimated total$55.97');
      expect(
        screen.getByText('Your order confirmation shows the final total.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Add another pizza' })).toHaveAttribute('href', '/');
    });

    it("changes a line's quantity with its buttons and updates every total", async () => {
      const user = userEvent.setup();
      renderCart();

      await user.click(screen.getByRole('button', { name: 'Increase quantity of Pepperoni' }));

      expect(screen.getByRole('status', { name: 'Quantity of Pepperoni' })).toHaveTextContent('2');
      expect(paragraphs(cartLine('Pepperoni')).at(-1)).toBe('$38.98');
      expect(estimatedTotal()).toBe('Estimated total$75.46');
      expect(screen.getByRole('link', { name: 'Cart, 4 items' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Decrease quantity of Margherita' }));

      expect(screen.getByRole('status', { name: 'Quantity of Margherita' })).toHaveTextContent('1');
      expect(paragraphs(cartLine('Margherita')).at(-1)).toBe('$18.24');
      expect(estimatedTotal()).toBe('Estimated total$57.22');
      expect(storedCart()).toEqual([
        { ...margheritaLine, quantity: 1 },
        { ...pepperoniLine, quantity: 2 },
      ]);
    });

    it(`keeps each quantity from 1 to ${MAX_QUANTITY_PER_ITEM}`, async () => {
      const user = userEvent.setup();
      renderCart([{ ...margheritaLine, quantity: MAX_QUANTITY_PER_ITEM }, pepperoniLine]);

      const decrease = screen.getByRole('button', { name: 'Decrease quantity of Pepperoni' });
      expect(decrease).toHaveAttribute('aria-disabled', 'true');
      await user.click(decrease);
      expect(screen.getByRole('status', { name: 'Quantity of Pepperoni' })).toHaveTextContent('1');
      // aria-disabled rather than disabled, so keyboard focus stays put.
      expect(decrease).toHaveFocus();

      const increase = screen.getByRole('button', { name: 'Increase quantity of Margherita' });
      expect(increase).toHaveAttribute('aria-disabled', 'true');
      await user.click(increase);
      expect(screen.getByRole('status', { name: 'Quantity of Margherita' })).toHaveTextContent(
        String(MAX_QUANTITY_PER_ITEM),
      );
      expect(
        screen.getByRole('button', { name: 'Increase quantity of Pepperoni' }),
      ).toHaveAttribute('aria-disabled', 'false');
    });

    it('removes a line and moves focus to the list heading', async () => {
      const user = userEvent.setup();
      renderCart();

      await user.click(screen.getByRole('button', { name: 'Remove Pepperoni' }));

      const lines = screen.getByRole('list', { name: 'Your pizzas' });
      expect(within(lines).getAllByRole('listitem')).toHaveLength(1);
      expect(within(lines).queryByRole('listitem', { name: 'Pepperoni' })).not.toBeInTheDocument();
      expect(estimatedTotal()).toBe('Estimated total$36.48');
      expect(screen.getByRole('heading', { level: 2, name: 'Your pizzas' })).toHaveFocus();
      expect(storedCart()).toEqual([margheritaLine]);
    });

    it('shows the empty cart once the last line is removed, with focus on the page heading', async () => {
      const user = userEvent.setup();
      renderCart([pepperoniLine]);

      await user.click(screen.getByRole('button', { name: 'Remove Pepperoni' }));

      expect(screen.getByRole('status')).toHaveTextContent('Your cart is empty');
      expect(screen.getByRole('heading', { level: 1, name: 'Your cart' })).toHaveFocus();
      expect(screen.queryByRole('form', { name: 'Checkout' })).not.toBeInTheDocument();
      expect(storedCart()).toBeNull();
    });
  });

  describe('checkout form', () => {
    it('asks for a phone number and optional notes, and says to pay at the counter', () => {
      renderCart();

      const form = screen.getByRole('form', { name: 'Checkout' });
      expect(within(form).getByLabelText('Phone number')).toHaveAttribute('type', 'tel');
      expect(phoneField()).toBeRequired();
      expect(phoneField()).toHaveAccessibleDescription(
        'We use it to find your order. US and Canadian numbers only.',
      );
      expect(notesField()).not.toBeRequired();
      expect(notesField()).toHaveAccessibleDescription('Up to 500 characters.');
      expect(within(form).getByText('Pay at the counter.').parentElement).toHaveTextContent(
        'Pay at the counter. There is nothing to pay online: you pay when you pick up your order.',
      );
      expect(within(form).getByRole('button', { name: 'Place order' })).toBeEnabled();
      // Payment happens at the counter, so the form has no payment fields.
      expect(within(form).getAllByRole('textbox')).toEqual([phoneField(), notesField()]);
    });

    it('asks for the phone number before sending anything', async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      renderCart();

      await user.click(placeOrderButton());

      expect(fieldError(phoneField())).toBe('Enter your phone number.');
      expect(phoneField()).toHaveAttribute('aria-invalid', 'true');
      expect(phoneField()).toHaveFocus();
      expect(fetchSpy).not.toHaveBeenCalled();
      expectCartKept();
    });

    it.each([
      { name: 'an exchange code starting with 1', phone: '555-123-4567' },
      { name: 'nine digits', phone: '212-555-014' },
      { name: 'another country code', phone: '+44 20 7946 0958' },
      { name: 'letters', phone: 'call me' },
    ])('rejects a phone number with $name inline, sending nothing', async ({ phone }) => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      renderCart();

      await checkOut(user, { phone });

      expect(fieldError(phoneField())).toBe('Enter a 10-digit US or Canadian phone number.');
      expect(phoneField()).toHaveAttribute('aria-invalid', 'true');
      expect(phoneField()).toHaveFocus();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("clears a field's error as soon as it is edited", async () => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, 'fetch');
      renderCart();
      await checkOut(user, { phone: '555-123-4567' });

      await user.type(phoneField(), '8');

      expect(fieldError(phoneField())).toBeNull();
      expect(phoneField()).not.toHaveAttribute('aria-invalid');
    });

    it('rejects notes that are too long once trimmed, sending nothing', async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      renderCart();

      await checkOut(user, { notes: `  ${'x'.repeat(501)}  ` });

      expect(fieldError(notesField())).toBe('Notes can be at most 500 characters. These are 501.');
      expect(notesField()).toHaveAttribute('aria-invalid', 'true');
      expect(notesField()).toHaveFocus();
      // Too long is reported, never cut short.
      expect(notesField()).toHaveValue(`  ${'x'.repeat(501)}  `);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('accepts 500 characters of notes with spaces around them', async () => {
      const user = userEvent.setup();
      const fetchSpy = fakeApi(jsonResponse(order, 201));
      renderCart();

      await checkOut(user, { notes: `  ${'x'.repeat(500)}  ` });

      await expectConfirmation();
      expect(ordersSent(fetchSpy)).toEqual([
        { phoneNumber: '(212) 555-0142', notes: 'x'.repeat(500), items: sentItems },
      ]);
    });

    // 26 lines make a large page, so this test finds things by text and label
    // rather than by role, and allows for a busy machine.
    it('stops an order with more lines than the server accepts', { timeout: 20_000 }, async () => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      renderCart(
        Array.from({ length: 26 }, (_, index) => ({
          ...pepperoniLine,
          lineId: `line-${index + 1}`,
          menuItemId: index + 1,
          display: { ...pepperoniLine.display, menuItemName: `Pizza ${index + 1}` },
        })),
      );

      await user.click(phoneField());
      await user.paste('(212) 555-0142');
      await user.click(screen.getByText('Place order'));

      const message = screen.getByText(
        'An order can have at most 25 different pizzas. Remove some to place your order.',
      );
      expect(message.parentElement).toHaveAttribute('role', 'alert');
      expect(message.parentElement).toHaveTextContent(/^Your order was not placed\./);
      expect(screen.getByText('Place order')).toHaveFocus();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('placing the order', () => {
    it('sends ids and quantities only, the phone number as typed, and trimmed notes', async () => {
      const user = userEvent.setup();
      const fetchSpy = fakeApi(jsonResponse(order, 201));
      renderCart();

      await checkOut(user, { phone: '(212) 555-0142', notes: '  Ring the bell\n' });

      await expectConfirmation();
      expect(ordersSent(fetchSpy)).toEqual([
        { phoneNumber: '(212) 555-0142', notes: 'Ring the bell', items: sentItems },
      ]);
    });

    it('leaves the notes out when there are none', async () => {
      const user = userEvent.setup();
      const fetchSpy = fakeApi(jsonResponse(order, 201));
      renderCart();

      await checkOut(user, { phone: '212.555.0142', notes: ' \n ' });

      await expectConfirmation();
      expect(ordersSent(fetchSpy)).toEqual([{ phoneNumber: '212.555.0142', items: sentItems }]);
    });

    it("opens the confirmation with the server's order, empties the cart, and saves the phone", async () => {
      const user = userEvent.setup();
      fakeApi(jsonResponse(order, 201));
      renderCart();

      await checkOut(user, { phone: '+1 212 555 0142' });

      await expectConfirmation();
      // The confirmation shows the server's snapshot total, not the estimate (ADR 0003 rule 5).
      expect(screen.getByRole('list', { name: 'Your order' }).nextElementSibling).toHaveTextContent(
        'Total$56.97',
      );
      expect(screen.queryByText('$55.97')).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Cart, empty' })).toBeInTheDocument();
      expect(localStorage.getItem(PHONE_KEY)).toBe('+12125550142');
      // CartProvider writes storage in an effect, which a transition's commit runs later.
      await waitFor(() => expect(storedCart()).toBeNull(), WAIT);
    });

    it('goes straight to the confirmation without showing the empty cart on the way', async () => {
      const user = userEvent.setup();
      fakeApi(jsonResponse(order, 201));
      renderCart();
      const added: string[] = [];
      const collect = (records: MutationRecord[]) => {
        for (const record of records) {
          record.addedNodes.forEach((node) => added.push(node.textContent ?? ''));
        }
      };
      const observer = new MutationObserver(collect);
      observer.observe(document.body, { childList: true, subtree: true });

      await checkOut(user);
      await expectConfirmation();
      collect(observer.takeRecords());
      observer.disconnect();

      expect(added.some((text) => text.includes('Your cart is empty'))).toBe(false);
    });

    it('still opens the confirmation when the phone number cannot be saved', async () => {
      const user = userEvent.setup();
      fakeApi(jsonResponse(order, 201));
      renderCart();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Storage is full', 'QuotaExceededError');
      });

      await checkOut(user);

      await expectConfirmation();
      expect(localStorage.getItem(PHONE_KEY)).toBeNull();
      await waitFor(() => expect(storedCart()).toBeNull(), WAIT);
    });

    it('disables the form and the cart while the order is being placed, so it is sent once', async () => {
      const user = userEvent.setup();
      const response = pendingResponse();
      const fetchSpy = fakeApi(response.promise);
      renderCart();

      await checkOut(user);

      const placing = screen.getByRole('button', { name: 'Placing your order…' });
      expect(placing).toBeDisabled();
      expect(phoneField()).toBeDisabled();
      expect(notesField()).toBeDisabled();
      for (const name of ['Margherita', 'Pepperoni']) {
        for (const button of within(cartLine(name)).getAllByRole('button')) {
          expect(button).toBeDisabled();
        }
      }
      await user.dblClick(placing);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      response.send(jsonResponse(order, 201));

      await expectConfirmation();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('when the order is not placed', () => {
    it('shows INVALID_PHONE_NUMBER under the phone field and keeps the cart', async () => {
      const user = userEvent.setup();
      fakeApi(
        errorResponse(
          400,
          'INVALID_PHONE_NUMBER',
          'Phone number must be a valid 10-digit US or Canadian number',
        ),
      );
      renderCart();

      await checkOut(user);

      await waitFor(() => expect(phoneField()).toHaveFocus(), WAIT);
      expect(fieldError(phoneField())).toBe(
        'Phone number must be a valid 10-digit US or Canadian number',
      );
      expect(phoneField()).toHaveAttribute('aria-invalid', 'true');
      expect(phoneField()).toHaveValue('(212) 555-0142');
      expect(placeOrderButton()).toBeEnabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expectCartKept();
      expect(localStorage.getItem(PHONE_KEY)).toBeNull();
    });

    it('shows each VALIDATION_ERROR issue under its field, on its line, or above the button', async () => {
      const user = userEvent.setup();
      fakeApi(
        validationError([
          { path: 'notes', message: 'Notes must be at most 500 characters' },
          { path: 'phoneNumber', message: 'Invalid input: expected string, received number' },
          { path: 'items.1.quantity', message: 'Quantity must be a whole number from 1 to 20' },
          { path: 'items.0.menuItemId', message: 'Id must be a positive whole number' },
          { path: 'items', message: 'An order can have at most 25 items' },
          { path: 'items.7.menuItemId', message: 'Id 99 must be a positive whole number' },
        ]),
      );
      renderCart();

      await checkOut(user, { notes: 'Ring the bell' });

      await waitFor(() => expect(phoneField()).toHaveFocus(), WAIT);
      expect(fieldError(phoneField())).toBe('Invalid input: expected string, received number');
      expect(fieldError(notesField())).toBe('Notes must be at most 500 characters');
      expect(notesField()).toHaveAttribute('aria-invalid', 'true');
      expect(paragraphs(cartLine('Pepperoni')).slice(-2)).toEqual([
        'Quantity must be a whole number from 1 to 20',
        'Remove this pizza to place your order.',
      ]);
      // Only ITEM_UNAVAILABLE names what is unavailable; a validation issue keeps its message.
      expect(paragraphs(cartLine('Margherita')).slice(-2)).toEqual([
        'Id must be a positive whole number',
        'Remove this pizza to place your order.',
      ]);
      // Issues for the request as a whole, or for a line that was not sent, go above the button.
      expect(paragraphs(screen.getByRole('alert'))).toEqual([
        'Your order was not placed.',
        "Some pizzas in your cart can't be ordered right now. Remove them to place your order.",
        'An order can have at most 25 items',
        'Id 99 must be a positive whole number',
      ]);
      expectCartKept();
    });

    it('puts focus on the notes when they are the only field with a problem', async () => {
      const user = userEvent.setup();
      fakeApi(
        validationError([{ path: 'notes', message: 'Notes must be at most 500 characters' }]),
      );
      renderCart();

      await checkOut(user, { notes: 'Ring the bell' });

      await waitFor(() => expect(notesField()).toHaveFocus(), WAIT);
      expect(fieldError(notesField())).toBe('Notes must be at most 500 characters');
      expect(fieldError(phoneField())).toBeNull();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('names each unavailable item and topping on its line, and keeps the cart', async () => {
      const user = userEvent.setup();
      fakeApi(
        itemUnavailable([
          { path: 'items.0.toppingIds.1', message: 'Topping 12 is not available' },
          { path: 'items.1.menuItemId', message: 'Menu item 3 is not available' },
        ]),
      );
      renderCart();

      await checkOut(user);

      await waitFor(() => expect(placeOrderButton()).toHaveFocus(), WAIT);
      expect(paragraphs(cartLine('Margherita')).slice(-2)).toEqual([
        'Fresh Basil is not available right now.',
        'Remove this pizza to place your order.',
      ]);
      expect(paragraphs(cartLine('Pepperoni')).slice(-2)).toEqual([
        'Pepperoni is not available right now.',
        'Remove this pizza to place your order.',
      ]);
      expect(screen.getByRole('button', { name: 'Remove Margherita' })).toHaveAccessibleDescription(
        'Fresh Basil is not available right now. Remove this pizza to place your order.',
      );
      expect(paragraphs(screen.getByRole('alert'))).toEqual([
        'Your order was not placed.',
        "Some pizzas in your cart can't be ordered right now. Remove them to place your order.",
      ]);
      expectCartKept();
    });

    it('names an unavailable size or crust the way the cart shows it', async () => {
      const user = userEvent.setup();
      fakeApi(
        itemUnavailable([
          { path: 'items.0.sizeId', message: 'Size 2 is not available' },
          { path: 'items.0.crustId', message: 'Crust 3 is not available' },
          { path: 'items.1.toppingIds.4', message: 'Topping 99 is not available' },
        ]),
      );
      renderCart();

      await checkOut(user);

      await waitFor(() => expect(placeOrderButton()).toHaveFocus(), WAIT);
      expect(paragraphs(cartLine('Margherita')).slice(-3)).toEqual([
        'Medium is not available right now.',
        'Stuffed Crust is not available right now.',
        'Remove this pizza to place your order.',
      ]);
      // A topping the line does not have keeps the server's own message.
      expect(paragraphs(cartLine('Pepperoni')).slice(-2)).toEqual([
        'Topping 99 is not available',
        'Remove this pizza to place your order.',
      ]);
    });

    it('drops the notice once the unavailable pizzas are removed, and then places the order', async () => {
      const user = userEvent.setup();
      const fetchSpy = fakeApi(
        itemUnavailable([{ path: 'items.1.menuItemId', message: 'Menu item 3 is not available' }]),
        jsonResponse(order, 201),
      );
      renderCart();
      await checkOut(user);
      await screen.findByRole('alert', {}, WAIT);

      await user.click(screen.getByRole('button', { name: 'Remove Pepperoni' }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(within(cartLine('Margherita')).queryByText(/not available/)).not.toBeInTheDocument();

      await user.click(placeOrderButton());

      await expectConfirmation();
      expect(ordersSent(fetchSpy)).toEqual([
        { phoneNumber: '(212) 555-0142', items: sentItems },
        { phoneNumber: '(212) 555-0142', items: [sentItems[0]] },
      ]);
    });

    it("keeps the server's line problems when the form stops the next try", async () => {
      const user = userEvent.setup();
      const fetchSpy = fakeApi(
        itemUnavailable([{ path: 'items.1.menuItemId', message: 'Menu item 3 is not available' }]),
      );
      renderCart();
      await checkOut(user);
      await screen.findByRole('alert', {}, WAIT);

      await user.clear(phoneField());
      await user.click(placeOrderButton());

      expect(fieldError(phoneField())).toBe('Enter your phone number.');
      expect(phoneField()).toHaveFocus();
      expect(
        within(cartLine('Pepperoni')).getByText('Pepperoni is not available right now.'),
      ).toBeInTheDocument();
      expect(paragraphs(screen.getByRole('alert'))).toEqual([
        'Your order was not placed.',
        "Some pizzas in your cart can't be ordered right now. Remove them to place your order.",
      ]);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("shows a line's problems only while it holds the selections they were reported for", async () => {
      const user = userEvent.setup();
      fakeApi(
        itemUnavailable([{ path: 'items.1.menuItemId', message: 'Menu item 3 is not available' }]),
      );
      renderCart();
      await checkOut(user);
      await screen.findByRole('alert', {}, WAIT);

      // Another tab changes the line's quantity: it is still the same pizza.
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: CART_STORAGE_KEY,
            newValue: JSON.stringify([margheritaLine, { ...pepperoniLine, quantity: 3 }]),
          }),
        );
      });
      expect(
        within(cartLine('Pepperoni')).getByText('Pepperoni is not available right now.'),
      ).toBeInTheDocument();

      // Another tab replaces the cart, and its second line is a different pizza.
      const hawaiianLine: CartLineItem = {
        ...pepperoniLine,
        menuItemId: 4,
        display: { ...pepperoniLine.display, menuItemName: 'Hawaiian', unitPriceCents: 2099 },
      };
      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: CART_STORAGE_KEY,
            newValue: JSON.stringify([margheritaLine, hawaiianLine]),
          }),
        );
      });
      expect(within(cartLine('Hawaiian')).queryByText(/available/)).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it.each([
      {
        name: 'no response',
        answer: () => Promise.reject(new TypeError('Failed to fetch')),
        message: "Can't reach the server. Check your connection and try again.",
      },
      {
        name: 'a server error',
        answer: () =>
          Promise.resolve(
            errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'),
          ),
        message: 'Something went wrong. Please try again.',
      },
      {
        name: 'a response that is not JSON',
        answer: () => Promise.resolve(new Response('Bad Gateway', { status: 502 })),
        message: 'The server sent an unexpected response (HTTP 502). Please try again.',
      },
    ])(
      'shows $name above the button and lets the customer try again',
      async ({ answer, message }) => {
        const user = userEvent.setup();
        const fetchSpy = vi
          .spyOn(globalThis, 'fetch')
          .mockImplementationOnce(answer)
          .mockResolvedValueOnce(jsonResponse(order, 201));
        renderCart();

        await checkOut(user, { notes: 'Ring the bell' });

        await waitFor(() => expect(placeOrderButton()).toHaveFocus(), WAIT);
        expect(paragraphs(screen.getByRole('alert'))).toEqual([
          'Your order was not placed.',
          message,
        ]);
        expect(phoneField()).toHaveValue('(212) 555-0142');
        expect(notesField()).toHaveValue('Ring the bell');
        expectCartKept();

        await user.click(placeOrderButton());

        await expectConfirmation();
        expect(fetchSpy).toHaveBeenCalledTimes(2);
      },
    );

    it('clears the last failure while the order is sent again', async () => {
      const user = userEvent.setup();
      const response = pendingResponse();
      fakeApi(
        itemUnavailable([{ path: 'items.1.menuItemId', message: 'Menu item 3 is not available' }]),
        response.promise,
      );
      renderCart();
      await checkOut(user);
      await screen.findByRole('alert', {}, WAIT);

      await user.click(placeOrderButton());

      expect(screen.getByRole('button', { name: 'Placing your order…' })).toBeDisabled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(within(cartLine('Pepperoni')).queryByText(/not available/)).not.toBeInTheDocument();

      response.send(jsonResponse(order, 201));
      await expectConfirmation();
    });
  });
});
