import type { OrderDetails, OrderDetailsItem } from '@fired-up-pizza/shared/orders-api';
import { screen, within } from '@testing-library/react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, renderWithProviders } from '../../test/render';
import { OrderConfirmationPage } from './OrderConfirmationPage';

// Built from local parts, so "6:05 PM" holds in any time zone.
const placedAt = new Date(2026, 9, 15, 18, 5).toISOString();

const margheritas: OrderDetailsItem = {
  id: 57,
  menuItemId: 2,
  sizeId: 2,
  crustId: 3,
  quantity: 2,
  unitPriceCents: 1824,
  menuItemName: 'Margherita',
  sizeName: 'Medium',
  crustName: 'Stuffed Crust',
  toppings: [
    { toppingId: 7, priceCents: 150, toppingName: 'Mushrooms' },
    { toppingId: 12, priceCents: 100, toppingName: 'Fresh Basil' },
  ],
};

const pepperoni: OrderDetailsItem = {
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
};

/** The order as POST /api/orders returned it: snapshot prices, an E.164 phone. */
const order: OrderDetails = {
  id: 42,
  phoneNumber: '+12125550142',
  status: 'placed',
  totalCents: 5597,
  notes: 'Extra napkins, please',
  createdAt: placedAt,
  updatedAt: placedAt,
  items: [margheritas, pepperoni],
  statusEvents: [{ id: 90, fromStatus: null, toStatus: 'placed', changedAt: placedAt }],
};

/** Opens a confirmation URL the way checkout does: by navigating to it with router state. */
function renderConfirmation(state: unknown, path = `/order-confirmation/${order.id}`) {
  renderWithProviders(
    <Routes>
      <Route index element={<Navigate to={path} state={state} />} />
      <Route path="order-confirmation/:orderId" element={<OrderConfirmationPage />} />
    </Routes>,
  );
}

/** The text of each paragraph in an ordered line, top to bottom. */
function paragraphs(line: HTMLElement): (string | null)[] {
  return Array.from(line.querySelectorAll('p'), (paragraph) => paragraph.textContent);
}

async function expectNoOrderShown() {
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Order confirmation' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Order details show here only right after checkout/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Track your order' })).toHaveAttribute('href', '/track');
  expect(screen.queryByRole('heading', { name: /^Order #/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Your order' })).not.toBeInTheDocument();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OrderConfirmationPage', () => {
  it('shows the order number, when it was placed, and its status', async () => {
    renderConfirmation(order);

    expect(await screen.findByRole('heading', { level: 1, name: 'Order #42' })).toBeInTheDocument();
    expect(screen.getByText('Thanks! Your order is in.')).toBeInTheDocument();
    const summary = screen.getByText(/^Placed at/);
    expect(summary).toHaveTextContent('Placed at 6:05 PM · Status: Placed');
    expect(within(summary).getByText('6:05 PM')).toHaveAttribute('dateTime', placedAt);
  });

  it('lists every item with its customizations, priced from the stored unit prices', async () => {
    renderConfirmation(order);

    const list = await screen.findByRole('list', { name: 'Your order' });
    const lines = within(list).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(paragraphs(lines[0]!)).toEqual([
      '2 × Margherita',
      'Medium, Stuffed Crust',
      'Toppings: Mushrooms, Fresh Basil',
      '$18.24 each',
      '$36.48',
    ]);
    expect(paragraphs(lines[1]!)).toEqual(['1 × Pepperoni', 'Large, Hand-Tossed', '$19.49']);
  });

  it("shows the server's snapshot total, not one computed from the lines", async () => {
    // A total the lines do not add up to proves the page takes the stored one (ADR 0003 rule 4).
    renderConfirmation({ ...order, totalCents: 5000 });

    const list = await screen.findByRole('list', { name: 'Your order' });
    expect(list.nextElementSibling).toHaveTextContent('Total$50.00');
    expect(screen.getByText(/^You'll pay/)).toHaveTextContent(
      "You'll pay $50.00 when you pick up your order.",
    );
    expect(screen.queryByText('$55.97')).not.toBeInTheDocument();
  });

  it('shows the notes for the kitchen, keeping their line breaks', async () => {
    renderConfirmation({ ...order, notes: 'Extra napkins, please\nRing the bell' });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Notes for the kitchen' }),
    ).toBeInTheDocument();
    const notes = screen.getByText(/^Extra napkins, please/);
    expect(notes.textContent).toBe('Extra napkins, please\nRing the bell');
    expect(notes).toHaveClass('whitespace-pre-wrap');
  });

  it('leaves out the notes section for an order without notes', async () => {
    renderConfirmation({ ...order, notes: '' });

    await screen.findByRole('heading', { level: 1, name: 'Order #42' });
    expect(screen.queryByText('Notes for the kitchen')).not.toBeInTheDocument();
  });

  it('says to pay at the counter and links to tracking with the phone number to use', async () => {
    renderConfirmation(order);

    expect(await screen.findByText('Pay at the counter.')).toBeInTheDocument();
    expect(screen.getByText(/^To see how your order is doing/)).toHaveTextContent(
      'To see how your order is doing, track it with (212) 555-0142, the phone number you ordered with.',
    );
    // The phone number never goes into a URL (ADR 0005 rule 5, ADR 0007 rule 9).
    expect(screen.getByRole('link', { name: 'Track your order' })).toHaveAttribute(
      'href',
      '/track',
    );
    expect(screen.getByRole('link', { name: 'Back to the menu' })).toHaveAttribute('href', '/');
  });

  it('shows the confirmation without sending any request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderConfirmation(order);

    await screen.findByRole('heading', { level: 1, name: 'Order #42' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('links a direct visit, which has no order to show, to order tracking', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderApp('/order-confirmation/42');

    await expectNoOrderShown();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not show an order under the URL of a different one', async () => {
    renderConfirmation(order, '/order-confirmation/41');

    await expectNoOrderShown();
  });

  it.each([
    { name: 'a string', state: 'order 42' },
    { name: 'an object that is not an order', state: { orderId: 42 } },
    { name: 'an order without items', state: { ...order, items: undefined } },
    { name: 'an order with an unknown status', state: { ...order, status: 'shipped' } },
    { name: 'an order with a total in dollars', state: { ...order, totalCents: 55.97 } },
    {
      name: 'an item without its names',
      state: { ...order, items: [{ ...margheritas, menuItemName: undefined }] },
    },
    {
      name: 'an item whose toppings are not a list',
      state: { ...order, items: [{ ...margheritas, toppings: 'Mushrooms' }] },
    },
    {
      name: 'a topping without its name',
      state: { ...order, items: [{ ...margheritas, toppings: [{ toppingId: 7 }] }] },
    },
  ])(
    'links to order tracking instead of crashing on router state that is $name',
    async ({ state }) => {
      renderConfirmation(state);

      await expectNoOrderShown();
    },
  );
});
