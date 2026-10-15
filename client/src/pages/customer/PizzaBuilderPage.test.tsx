import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import { MAX_TOPPINGS_PER_ITEM } from '@fired-up-pizza/shared/pricing';
import { act, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, renderWithProviders } from '../../test/render';
import { PizzaBuilderPage } from './PizzaBuilderPage';

// The cart page is another bead's work. This stand-in prints the cart's lines
// as JSON, so a test can check exactly what "Add to cart" put in the cart.
vi.mock('./CartPage', async () => {
  const { useCart } = await import('../../context/CartContext');
  function CartPage() {
    const { items } = useCart();
    return (
      <section aria-label="Cart lines">
        <pre>{JSON.stringify(items)}</pre>
      </section>
    );
  }
  return { CartPage };
});

const createdAt = '2026-10-14T23:41:39.000Z';

function menuItem(item: Omit<MenuItem, 'available' | 'createdAt'>): MenuItem {
  return { ...item, available: true, createdAt };
}

function topping(id: number, name: string, priceCents: number): Topping {
  return { id, name, priceCents, available: true };
}

// The seeded catalog (server/src/db/seed.ts), as the customer endpoints send it.
const cheese = menuItem({
  id: 1,
  name: 'Cheese',
  description: 'Tomato sauce and a blend of mozzarella and provolone.',
  category: 'Classic',
  basePriceCents: 999,
});
const margherita = menuItem({
  id: 2,
  name: 'Margherita',
  description: 'San Marzano tomato sauce, fresh mozzarella, basil, and extra-virgin olive oil.',
  category: 'Classic',
  basePriceCents: 1099,
});
const pepperoniPizza = menuItem({
  id: 3,
  name: 'Pepperoni',
  description: 'Tomato sauce, mozzarella, and crispy cup-and-char pepperoni.',
  category: 'Classic',
  basePriceCents: 1299,
});

/** Smallest price multiplier first. */
const sizes: Size[] = [
  { id: 1, name: 'Small', priceMultiplier: 1 },
  { id: 2, name: 'Medium', priceMultiplier: 1.25 },
  { id: 3, name: 'Large', priceMultiplier: 1.5 },
];

/** Cheapest first, then by name. */
const crusts: Crust[] = [
  { id: 1, name: 'Hand-Tossed', priceDeltaCents: 0 },
  { id: 2, name: 'Thin & Crispy', priceDeltaCents: 0 },
  { id: 3, name: 'Stuffed Crust', priceDeltaCents: 200 },
  { id: 4, name: 'Gluten-Free', priceDeltaCents: 300 },
];

/** By name. Twelve of them, two more than MAX_TOPPINGS_PER_ITEM allows on one pizza. */
const toppings: Topping[] = [
  topping(3, 'Bacon', 200),
  topping(10, 'Black Olives', 150),
  topping(6, 'Extra Cheese', 150),
  topping(12, 'Fresh Basil', 100),
  topping(8, 'Green Peppers', 150),
  topping(5, 'Grilled Chicken', 250),
  topping(4, 'Ham', 200),
  topping(2, 'Italian Sausage', 200),
  topping(7, 'Mushrooms', 150),
  topping(1, 'Pepperoni', 200),
  topping(11, 'Pineapple', 150),
  topping(9, 'Red Onions', 125),
];

interface Catalog {
  menuItems: MenuItem[];
  sizes: Size[];
  crusts: Crust[];
  toppings: Topping[];
}

/**
 * The customer list leaves hidden items out, so the seeded Hawaiian (id 4),
 * missing from this menu, stands for a pizza that staff have hidden.
 */
const catalog: Catalog = {
  menuItems: [cheese, margherita, pepperoniPizza],
  sizes,
  crusts,
  toppings,
};

const CATALOG_PATHS = ['/api/menu-items', '/api/sizes', '/api/crusts', '/api/toppings'] as const;
type CatalogPath = (typeof CATALOG_PATHS)[number];

type Answer = Response | Error | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : 'a request object';
}

function catalogBody(served: Catalog, path: CatalogPath): unknown {
  switch (path) {
    case '/api/menu-items':
      return served.menuItems;
    case '/api/sizes':
      return served.sizes;
    case '/api/crusts':
      return served.crusts;
    case '/api/toppings':
      return served.toppings;
  }
}

function isCatalogPath(path: string): path is CatalogPath {
  return (CATALOG_PATHS as readonly string[]).includes(path);
}

/**
 * Serves the customer catalog endpoints from `served`. `answers` queues other
 * answers for a path, which its next requests get first. Any other request
 * fails as if the server were down.
 */
function serveCatalog(
  served: Catalog = catalog,
  answers: Partial<Record<CatalogPath, Answer[]>> = {},
) {
  const queues = new Map<string, Answer[]>(Object.entries(answers));
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const path = pathOf(input);
    const answer = queues.get(path)?.shift();
    if (answer !== undefined) {
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    }
    if (!isCatalogPath(path)) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return Promise.resolve(jsonResponse(catalogBody(served, path)));
  });
}

/** A response the test sends when it chooses. */
function pendingResponse() {
  let send!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    send = resolve;
  });
  return { promise, send };
}

/** Renders the whole app at the builder for `menuItemId` and waits for the builder. */
async function openBuilder(menuItemId: number, name: string) {
  renderApp(`/menu/${menuItemId}`);
  expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
}

function summary(): HTMLElement {
  return screen.getByRole('region', { name: 'Your pizza' });
}

function expectPrices(each: string, total: string) {
  expect(summary()).toHaveTextContent(`Price each ${each}`);
  expect(summary()).toHaveTextContent(`Total ${total}`);
}

function radio(name: string): HTMLElement {
  return screen.getByRole('radio', { name });
}

function checkbox(name: string): HTMLElement {
  return screen.getByRole('checkbox', { name });
}

function quantityField(): HTMLElement {
  return screen.getByRole('spinbutton', { name: 'Quantity' });
}

/** A topping's checkbox, named by the topping's name and then its price. */
function toppingCheckbox(name: string): HTMLElement {
  return screen.getByRole('checkbox', {
    name: (accessibleName) => accessibleName.startsWith(`${name} +`),
  });
}

/** Checks the choices in a group: their accessible names, in page order. */
function expectChoices(group: string, role: 'radio' | 'checkbox', names: string[]) {
  const choices = within(screen.getByRole('group', { name: group })).getAllByRole(role);
  expect(choices).toHaveLength(names.length);
  names.forEach((name, index) => {
    expect(choices[index]).toHaveAccessibleName(name);
  });
}

/** The lines the stand-in cart page shows, once "Add to cart" has opened it. */
function cartLines(): unknown {
  return JSON.parse(screen.getByRole('region', { name: 'Cart lines' }).textContent ?? '');
}

async function setQuantity(user: UserEvent, quantity: number) {
  await user.clear(quantityField());
  await user.type(quantityField(), String(quantity));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PizzaBuilderPage', () => {
  it('shows a loading state, then the pizza with its first size and crust chosen', async () => {
    const fetchSpy = serveCatalog();

    renderApp('/menu/2');

    expect(screen.getByRole('heading', { level: 1, name: 'Build your pizza' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the pizza builder…');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Margherita' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'San Marzano tomato sauce, fresh mozzarella, basil, and extra-virgin olive oil.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading the pizza builder…')).not.toBeInTheDocument();
    expect(radio('Small $10.99')).toBeChecked();
    expect(radio('Hand-Tossed')).toBeChecked();
    expect(screen.queryByRole('checkbox', { checked: true })).not.toBeInTheDocument();
    expect(quantityField()).toHaveValue(1);
    expectPrices('$10.99', '$10.99');
    expect(fetchSpy.mock.calls.map(([input]) => pathOf(input))).toEqual([...CATALOG_PATHS]);
  });

  it('labels every choice with its price', async () => {
    serveCatalog();

    await openBuilder(2, 'Margherita');

    // Each size prices the plain pizza: round(1099 × 1.25) = 1374, round(1099 × 1.5) = 1649.
    expectChoices('Size', 'radio', ['Small $10.99', 'Medium $13.74', 'Large $16.49']);
    // A crust shows a price only when it costs extra.
    expectChoices('Crust', 'radio', [
      'Hand-Tossed',
      'Thin & Crispy',
      'Stuffed Crust +$2.00',
      'Gluten-Free +$3.00',
    ]);
    expectChoices('Toppings', 'checkbox', [
      'Bacon +$2.00',
      'Black Olives +$1.50',
      'Extra Cheese +$1.50',
      'Fresh Basil +$1.00',
      'Green Peppers +$1.50',
      'Grilled Chicken +$2.50',
      'Ham +$2.00',
      'Italian Sausage +$2.00',
      'Mushrooms +$1.50',
      'Pepperoni +$2.00',
      'Pineapple +$1.50',
      'Red Onions +$1.25',
    ]);
    expect(screen.getByRole('group', { name: 'Toppings' })).toHaveAccessibleDescription(
      `Choose up to ${MAX_TOPPINGS_PER_ITEM}.`,
    );
  });

  it('updates the price each and the total as the choices change', async () => {
    serveCatalog();
    const user = userEvent.setup();

    await openBuilder(2, 'Margherita');

    await user.click(radio('Medium $13.74'));
    expectPrices('$13.74', '$13.74');

    await user.click(radio('Stuffed Crust +$2.00'));
    expectPrices('$15.74', '$15.74');

    await user.click(checkbox('Mushrooms +$1.50'));
    await user.click(checkbox('Fresh Basil +$1.00'));
    // round(1099 × 1.25) + 200 + 150 + 100
    expectPrices('$18.24', '$18.24');

    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(quantityField()).toHaveValue(2);
    expectPrices('$18.24', '$36.48');

    await user.click(checkbox('Mushrooms +$1.50'));
    expectPrices('$16.74', '$33.48');

    // round(1099 × 1.5) = 1649: 1648.5 rounds half up.
    await user.click(radio('Large $16.49'));
    expectPrices('$19.49', '$38.98');

    await setQuantity(user, 12);
    expectPrices('$19.49', '$233.88');
  });

  it(`stops at ${MAX_TOPPINGS_PER_ITEM} toppings until one is removed`, async () => {
    serveCatalog();
    const user = userEvent.setup();

    await openBuilder(1, 'Cheese');
    const chosen = toppings.slice(0, MAX_TOPPINGS_PER_ITEM);
    const leftOver = toppings.slice(MAX_TOPPINGS_PER_ITEM);
    for (const { name } of chosen) {
      await user.click(toppingCheckbox(name));
    }

    const toppingGroup = screen.getByRole('group', { name: 'Toppings' });
    expect(toppingGroup).toHaveAccessibleDescription(
      `You've chosen ${MAX_TOPPINGS_PER_ITEM} toppings, the most one pizza can have.`,
    );
    expect(within(toppingGroup).getAllByRole('checkbox', { checked: true })).toHaveLength(
      MAX_TOPPINGS_PER_ITEM,
    );
    for (const { name } of leftOver) {
      const option = toppingCheckbox(name);
      expect(option).toBeDisabled();
      await user.click(option);
      expect(option).not.toBeChecked();
    }
    // 999 + the ten chosen toppings' 1750
    expectPrices('$27.49', '$27.49');

    await user.click(checkbox('Bacon +$2.00'));

    expect(toppingGroup).toHaveAccessibleDescription(`Choose up to ${MAX_TOPPINGS_PER_ITEM}.`);
    for (const { name } of leftOver) {
      expect(toppingCheckbox(name)).toBeEnabled();
    }
    await user.click(checkbox('Red Onions +$1.25'));
    expect(checkbox('Red Onions +$1.25')).toBeChecked();
    expect(checkbox('Pineapple +$1.50')).toBeDisabled();
    // 999 + 1750 - 200 + 125
    expectPrices('$26.74', '$26.74');
  });

  it('adds the configured pizza to the cart and opens the cart', async () => {
    serveCatalog();
    const user = userEvent.setup();

    await openBuilder(2, 'Margherita');
    await user.click(radio('Medium $13.74'));
    await user.click(radio('Stuffed Crust +$2.00'));
    await user.click(checkbox('Mushrooms +$1.50'));
    await user.click(checkbox('Fresh Basil +$1.00'));
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    // The toppings keep the catalog's order, not the order they were picked in.
    expect(cartLines()).toEqual([
      {
        lineId: expect.any(String),
        menuItemId: 2,
        sizeId: 2,
        crustId: 3,
        toppingIds: [12, 7],
        quantity: 2,
        display: {
          menuItemName: 'Margherita',
          sizeName: 'Medium',
          crustName: 'Stuffed Crust',
          toppingNames: ['Fresh Basil', 'Mushrooms'],
          unitPriceCents: 1824,
        },
      },
    ]);
    expect(screen.queryByRole('heading', { level: 1, name: 'Margherita' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument();
  });

  it('adds a pizza with its first size and crust and no toppings as it opens', async () => {
    serveCatalog();
    const user = userEvent.setup();

    await openBuilder(3, 'Pepperoni');
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(cartLines()).toEqual([
      {
        lineId: expect.any(String),
        menuItemId: 3,
        sizeId: 1,
        crustId: 1,
        toppingIds: [],
        quantity: 1,
        display: {
          menuItemName: 'Pepperoni',
          sizeName: 'Small',
          crustName: 'Hand-Tossed',
          toppingNames: [],
          unitPriceCents: 1299,
        },
      },
    ]);
  });

  it('can be built and added with the keyboard alone', async () => {
    serveCatalog({
      ...catalog,
      toppings: [topping(12, 'Fresh Basil', 100), topping(7, 'Mushrooms', 150)],
    });
    const user = userEvent.setup();

    await openBuilder(2, 'Margherita');
    act(() => radio('Small $10.99').focus());

    await user.keyboard('{ArrowRight}');
    expect(radio('Medium $13.74')).toBeChecked();
    expect(radio('Medium $13.74')).toHaveFocus();

    await user.tab();
    expect(radio('Hand-Tossed')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(radio('Stuffed Crust +$2.00')).toBeChecked();

    await user.tab();
    expect(checkbox('Fresh Basil +$1.00')).toHaveFocus();
    await user.keyboard(' ');
    await user.tab();
    expect(checkbox('Mushrooms +$1.50')).toHaveFocus();
    await user.keyboard(' ');
    expect(checkbox('Fresh Basil +$1.00')).toBeChecked();
    expect(checkbox('Mushrooms +$1.50')).toBeChecked();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toHaveFocus();
    await user.tab();
    expect(quantityField()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(quantityField()).toHaveValue(2);
    expectPrices('$18.24', '$36.48');

    await user.tab();
    expect(screen.getByRole('button', { name: 'Add to cart' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(cartLines()).toEqual([
      expect.objectContaining({
        menuItemId: 2,
        sizeId: 2,
        crustId: 3,
        toppingIds: [12, 7],
        quantity: 2,
      }),
    ]);
  });

  it('starts over when the route moves to another pizza', async () => {
    const fetchSpy = serveCatalog();
    const user = userEvent.setup();

    renderWithProviders(
      <>
        <Link to="/menu/1">Open the cheese pizza</Link>
        <Routes>
          <Route path="/menu/:menuItemId" element={<PizzaBuilderPage />} />
        </Routes>
      </>,
      { route: '/menu/2' },
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Margherita' }),
    ).toBeInTheDocument();
    await user.click(radio('Large $16.49'));
    await user.click(checkbox('Mushrooms +$1.50'));
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));

    await user.click(screen.getByRole('link', { name: 'Open the cheese pizza' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Cheese' })).toBeInTheDocument();
    expect(radio('Small $9.99')).toBeChecked();
    expect(checkbox('Mushrooms +$1.50')).not.toBeChecked();
    expect(quantityField()).toHaveValue(1);
    expectPrices('$9.99', '$9.99');
    // The same page kept its catalog, so only its key started the choices over.
    expect(fetchSpy).toHaveBeenCalledTimes(CATALOG_PATHS.length);
  });

  it.each([
    { reason: 'an id no pizza has', path: '/menu/999' },
    { reason: 'a pizza the menu no longer lists, as when staff hide it', path: '/menu/4' },
    { reason: 'an id that is not a number', path: '/menu/margherita' },
    { reason: 'an id written differently from the menu links', path: '/menu/02' },
  ])('shows a not-found state with a link to the menu for $reason', async ({ path }) => {
    serveCatalog();

    renderApp(path);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pizza not found' }),
    ).toBeInTheDocument();
    expect(screen.getByText("That pizza isn't on our menu right now.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the menu' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
  });

  it('goes back to the menu from the not-found state', async () => {
    serveCatalog();
    const user = userEvent.setup();

    renderApp('/menu/999');
    await user.click(await screen.findByRole('link', { name: 'Back to the menu' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Menu' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Margherita from $10.99' })).toBeInTheDocument();
  });

  it.each([
    { list: 'menu items', path: '/api/menu-items' as const },
    { list: 'sizes', path: '/api/sizes' as const },
    { list: 'crusts', path: '/api/crusts' as const },
    { list: 'toppings', path: '/api/toppings' as const },
  ])('shows an error, not a missing pizza, when the $list fail to load', async ({ path }) => {
    serveCatalog(catalog, { [path]: [new TypeError('Failed to fetch')] });

    renderApp('/menu/2');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this pizza");
    expect(alert).toHaveTextContent("Can't reach the server.");
    expect(screen.queryByText('Pizza not found')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
  });

  it("shows the server's message when it fails", async () => {
    serveCatalog(catalog, {
      '/api/sizes': [
        jsonResponse(
          { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
          500,
        ),
      ],
    });

    renderApp('/menu/2');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load this pizza");
    expect(alert).toHaveTextContent('Something went wrong. Please try again.');
  });

  it('loads everything again when "Try again" is pressed', async () => {
    const retry = pendingResponse();
    const fetchSpy = serveCatalog(catalog, {
      '/api/toppings': [new TypeError('Failed to fetch'), retry.promise],
    });
    const user = userEvent.setup();

    renderApp('/menu/2');
    await user.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Try again' }),
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the pizza builder…');

    retry.send(jsonResponse(toppings));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Margherita' }),
    ).toBeInTheDocument();
    expect(checkbox('Bacon +$2.00')).not.toBeChecked();
    expect(fetchSpy.mock.calls.map(([input]) => pathOf(input))).toEqual([
      ...CATALOG_PATHS,
      ...CATALOG_PATHS,
    ]);
  });

  it('cancels every request when the page closes before the catalog arrives', () => {
    const pending = pendingResponse();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockReturnValue(pending.promise);

    const { unmount } = renderApp('/menu/2');
    const signals = fetchSpy.mock.calls.map(([, init]) => init?.signal);
    expect(signals).toHaveLength(CATALOG_PATHS.length);
    expect(signals.every((signal) => signal?.aborted === false)).toBe(true);

    unmount();

    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
  });

  it('can still be ordered without toppings when none are available', async () => {
    serveCatalog({ ...catalog, toppings: [] });
    const user = userEvent.setup();

    await openBuilder(2, 'Margherita');

    expect(
      within(screen.getByRole('group', { name: 'Toppings' })).getByText(
        'No toppings are available right now.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expectPrices('$10.99', '$10.99');

    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(cartLines()).toEqual([expect.objectContaining({ menuItemId: 2, toppingIds: [] })]);
  });

  it.each([
    { missing: 'sizes', served: { ...catalog, sizes: [] } },
    { missing: 'crusts', served: { ...catalog, crusts: [] } },
  ])('says the pizza cannot be ordered when there are no $missing', async ({ served }) => {
    serveCatalog(served);

    await openBuilder(2, 'Margherita');

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent("This pizza can't be ordered right now");
    expect(status).toHaveTextContent('Please check back soon.');
    expect(within(status).getByRole('link', { name: 'Back to the menu' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.queryByRole('button', { name: 'Add to cart' })).not.toBeInTheDocument();
  });

  it('shows a pizza without a description by its name alone', async () => {
    serveCatalog({ ...catalog, menuItems: [{ ...margherita, description: '' }] });

    await openBuilder(2, 'Margherita');

    const heading = screen.getByRole('heading', { level: 1, name: 'Margherita' });
    expect(heading.parentElement).toHaveTextContent(/^Margherita$/);
  });
});
