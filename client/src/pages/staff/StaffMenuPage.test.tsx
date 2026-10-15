import type { MenuItem, Topping } from '@fired-up-pizza/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, renderWithProviders } from '../../test/render';
import { StaffMenuPage } from './StaffMenuPage';

const createdAt = '2026-10-14T23:41:39.000Z';

const cheese: MenuItem = {
  id: 1,
  name: 'Cheese',
  description: 'Tomato sauce and a blend of mozzarella and provolone.',
  category: 'Classic',
  basePriceCents: 999,
  available: true,
  createdAt,
};
const margherita: MenuItem = {
  id: 2,
  name: 'Margherita',
  description: 'San Marzano tomato sauce, fresh mozzarella, basil, and extra-virgin olive oil.',
  category: 'Classic',
  basePriceCents: 1099,
  available: true,
  createdAt,
};
const hawaiian: MenuItem = {
  id: 4,
  name: 'Hawaiian',
  description: '',
  category: 'Specialty',
  basePriceCents: 1399,
  available: false,
  createdAt,
};
const truffle: MenuItem = {
  id: 10,
  name: 'Truffle Shuffle',
  description: 'Truffle cream, mushrooms, and fontina.',
  category: 'Specialty',
  basePriceCents: 1799,
  available: true,
  createdAt,
};

/** As GET /api/staff/menu-items sends them: by category, then name, hidden ones included. */
const menuItems = [cheese, margherita, hawaiian];

const bacon: Topping = { id: 1, name: 'Bacon', priceCents: 200, available: true };
const mushrooms: Topping = { id: 7, name: 'Mushrooms', priceCents: 150, available: true };
const pineapple: Topping = { id: 9, name: 'Pineapple', priceCents: 125, available: false };

/** As GET /api/staff/toppings sends them: by name, hidden ones included. */
const toppings = [bacon, mushrooms, pineapple];

const MENU_ITEMS = '/api/staff/menu-items';
const TOPPINGS = '/api/staff/toppings';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return jsonResponse({ error: { code, message, details } }, status);
}

function conflict(message: string): Response {
  return errorResponse(409, 'CONFLICT', message, { issues: [{ path: 'name', message }] });
}

/** A response the test sends when it chooses. */
function pendingResponse() {
  let send!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    send = resolve;
  });
  return { promise, send };
}

type Answer = Response | Error | Promise<Response>;

function routeOf(input: RequestInfo | URL, init?: RequestInit): string {
  return `${init?.method ?? 'GET'} ${typeof input === 'string' ? input : 'a request object'}`;
}

/**
 * Answers each request with the next answer queued for its method and path,
 * e.g. `'PATCH /api/staff/toppings/9': [jsonResponse(…)]`. Each list loads
 * once unless the test queues its own answers for it; every save reloads its
 * list, so those tests queue a second answer. A request with no answer left
 * fails as if the server were down.
 */
function fakeApi(answers: Record<string, Answer[]> = {}) {
  const queues = new Map<string, Answer[]>([
    [`GET ${MENU_ITEMS}`, [jsonResponse(menuItems)]],
    [`GET ${TOPPINGS}`, [jsonResponse(toppings)]],
    ...Object.entries(answers),
  ]);
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const answer = queues.get(routeOf(input, init))?.shift();
    if (answer === undefined) {
      return Promise.reject(new TypeError('Failed to fetch'));
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

type FetchSpy = ReturnType<typeof fakeApi>;

function requestCount(fetchSpy: FetchSpy, route: string): number {
  return fetchSpy.mock.calls.filter(([input, init]) => routeOf(input, init) === route).length;
}

/** The JSON bodies sent to a route, in order. */
function bodiesSent(fetchSpy: FetchSpy, route: string): unknown[] {
  return fetchSpy.mock.calls
    .filter(([input, init]) => routeOf(input, init) === route)
    .map(([, init]) => (typeof init?.body === 'string' ? JSON.parse(init.body) : undefined));
}

function section(name: 'Menu items' | 'Toppings'): HTMLElement {
  return screen.getByRole('region', { name });
}

function row(sectionName: 'Menu items' | 'Toppings', name: string): HTMLElement {
  return within(section(sectionName)).getByRole('listitem', { name });
}

/** Replaces the text of each field, found by its label within `form`. */
async function fill(user: UserEvent, form: HTMLElement, fields: Record<string, string>) {
  for (const [label, text] of Object.entries(fields)) {
    const field = within(form).getByLabelText(label);
    await user.clear(field);
    if (text !== '') {
      await user.paste(text);
    }
  }
}

/** Renders the page and waits until both lists are on screen. */
async function renderLoadedPage(): Promise<UserEvent> {
  const user = userEvent.setup();
  renderWithProviders(<StaffMenuPage />);
  await screen.findByRole('list', { name: 'Menu items' });
  await screen.findByRole('list', { name: 'Toppings' });
  return user;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StaffMenuPage lists', () => {
  it('shows each list loading, then every row in the order the server sends', async () => {
    const fetchSpy = fakeApi();

    renderWithProviders(<StaffMenuPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Menu management' })).toBeInTheDocument();
    expect(within(section('Menu items')).getByText('Loading menu items…')).toBeInTheDocument();
    expect(within(section('Toppings')).getByText('Loading toppings…')).toBeInTheDocument();

    const menuList = await screen.findByRole('list', { name: 'Menu items' });
    const toppingList = await screen.findByRole('list', { name: 'Toppings' });
    const names = (list: HTMLElement) =>
      within(list)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent);
    expect(names(menuList)).toEqual(['Cheese', 'Margherita', 'Hawaiian']);
    expect(names(toppingList)).toEqual(['Bacon', 'Mushrooms', 'Pineapple']);
    expect(screen.queryByText(/^Loading/)).not.toBeInTheDocument();
    expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(1);
    expect(requestCount(fetchSpy, `GET ${TOPPINGS}`)).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('shows what customers see of each row and marks the hidden ones', async () => {
    fakeApi();
    await renderLoadedPage();

    const margheritaRow = row('Menu items', 'Margherita');
    expect(within(margheritaRow).getByText('Classic · $10.99')).toBeInTheDocument();
    expect(within(margheritaRow).getByText(margherita.description)).toBeInTheDocument();
    expect(within(margheritaRow).queryByText('Hidden')).not.toBeInTheDocument();
    expect(within(margheritaRow).getByRole('button', { name: 'Edit Margherita' })).toBeEnabled();
    expect(within(margheritaRow).getByRole('button', { name: 'Hide Margherita' })).toBeEnabled();

    const hawaiianRow = row('Menu items', 'Hawaiian');
    expect(within(hawaiianRow).getByText('Hidden')).toBeInTheDocument();
    expect(within(hawaiianRow).getByText('Specialty · $13.99')).toBeInTheDocument();
    expect(within(hawaiianRow).getByRole('button', { name: 'Show Hawaiian' })).toBeEnabled();

    const baconRow = row('Toppings', 'Bacon');
    expect(within(baconRow).getByText('$2.00')).toBeInTheDocument();
    expect(within(baconRow).queryByText('Hidden')).not.toBeInTheDocument();
    expect(within(baconRow).getByRole('button', { name: 'Hide Bacon' })).toBeEnabled();

    const pineappleRow = row('Toppings', 'Pineapple');
    expect(within(pineappleRow).getByText('Hidden')).toBeInTheDocument();
    expect(within(pineappleRow).getByText('$1.25')).toBeInTheDocument();
    expect(within(pineappleRow).getByRole('button', { name: 'Show Pineapple' })).toBeEnabled();
  });

  it('shows an empty state, and still offers the create form, for a catalog with no rows', async () => {
    fakeApi({ [`GET ${MENU_ITEMS}`]: [jsonResponse([])] });

    renderWithProviders(<StaffMenuPage />);

    const menu = section('Menu items');
    expect(await within(menu).findByText('No menu items yet')).toBeInTheDocument();
    expect(within(menu).getByText('Use the form to add the first one.')).toBeInTheDocument();
    expect(within(menu).queryByRole('list')).not.toBeInTheDocument();
    expect(within(menu).getByRole('form', { name: 'Add a menu item' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Toppings' })).toBeInTheDocument();
  });

  it('shows an error with a retry for a list that fails, without holding up the other', async () => {
    const retry = pendingResponse();
    const fetchSpy = fakeApi({
      [`GET ${TOPPINGS}`]: [
        errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'),
        retry.promise,
      ],
    });
    const user = userEvent.setup();

    renderWithProviders(<StaffMenuPage />);

    const toppingSection = section('Toppings');
    const alert = await within(toppingSection).findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the toppings");
    expect(alert).toHaveTextContent('Something went wrong. Please try again.');
    expect(within(toppingSection).queryByText('No toppings yet')).not.toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Menu items' })).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));

    expect(within(toppingSection).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(toppingSection).getByText('Loading toppings…')).toBeInTheDocument();

    retry.send(jsonResponse(toppings));

    expect(await within(toppingSection).findByRole('listitem', { name: 'Bacon' })).toBeVisible();
    expect(requestCount(fetchSpy, `GET ${TOPPINGS}`)).toBe(2);
    expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(1);
  });

  it('is the page at /staff/menu, inside the staff layout', async () => {
    fakeApi();

    renderApp('/staff/menu');

    expect(screen.getByRole('heading', { level: 1, name: 'Menu management' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Staff' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Menu items' })).toBeInTheDocument();
  });

  it('cancels the list requests when the page closes before they finish', () => {
    const fetchSpy = fakeApi({
      [`GET ${MENU_ITEMS}`]: [pendingResponse().promise],
      [`GET ${TOPPINGS}`]: [pendingResponse().promise],
    });

    const { unmount } = renderWithProviders(<StaffMenuPage />);
    const signals = fetchSpy.mock.calls.map(([, init]) => init?.signal);
    expect(signals).toHaveLength(2);
    expect(signals.map((signal) => signal?.aborted)).toEqual([false, false]);

    unmount();

    expect(signals.map((signal) => signal?.aborted)).toEqual([true, true]);
  });
});

describe('StaffMenuPage create', () => {
  it('adds a menu item: pending while it saves, then the new row, a message, and an empty form', async () => {
    const post = pendingResponse();
    const fetchSpy = fakeApi({
      [`POST ${MENU_ITEMS}`]: [post.promise],
      [`GET ${MENU_ITEMS}`]: [jsonResponse(menuItems), jsonResponse([...menuItems, truffle])],
    });
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a menu item' });

    await fill(user, form, {
      Name: ' Truffle Shuffle ',
      Category: 'Specialty',
      Price: '17.99',
      'Description (optional)': 'Truffle cream, mushrooms, and fontina.',
    });
    await user.click(within(form).getByRole('button', { name: 'Add menu item' }));

    expect(within(form).getByRole('button', { name: 'Adding…' })).toBeDisabled();
    for (const label of ['Name', 'Category', 'Price', 'Description (optional)']) {
      expect(within(form).getByLabelText(label)).toBeDisabled();
    }
    expect(bodiesSent(fetchSpy, `POST ${MENU_ITEMS}`)).toEqual([
      {
        name: 'Truffle Shuffle',
        description: 'Truffle cream, mushrooms, and fontina.',
        category: 'Specialty',
        basePriceCents: 1799,
      },
    ]);

    post.send(jsonResponse(truffle, 201));

    const menu = section('Menu items');
    const message = await within(menu).findByText('Added Truffle Shuffle.');
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(within(menu).getByRole('listitem', { name: 'Truffle Shuffle' })).toBeInTheDocument();
    for (const label of ['Name', 'Category', 'Price', 'Description (optional)']) {
      expect(within(form).getByLabelText(label)).toHaveValue('');
      expect(within(form).getByLabelText(label)).toBeEnabled();
    }
    expect(within(form).getByLabelText('Name')).toHaveFocus();
    await waitFor(() => expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(2));
  });

  it.each([
    ['10', 1000],
    ['10.5', 1050],
    ['10.05', 1005],
    ['4.35', 435],
    ['$1.25', 125],
    ['.75', 75],
    ['1000', 100_000],
  ])('sends a price typed as %j as %i cents', async (price, cents) => {
    const jalapenos: Topping = { id: 13, name: 'Jalapenos', priceCents: cents, available: true };
    const fetchSpy = fakeApi({
      [`POST ${TOPPINGS}`]: [jsonResponse(jalapenos, 201)],
      [`GET ${TOPPINGS}`]: [
        jsonResponse(toppings),
        jsonResponse([bacon, jalapenos, mushrooms, pineapple]),
      ],
    });
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a topping' });

    await fill(user, form, { Name: 'Jalapenos', Price: price });
    await user.click(within(form).getByRole('button', { name: 'Add topping' }));

    expect(await within(section('Toppings')).findByText('Added Jalapenos.')).toBeInTheDocument();
    expect(bodiesSent(fetchSpy, `POST ${TOPPINGS}`)).toEqual([
      { name: 'Jalapenos', priceCents: cents },
    ]);
  });

  it.each([
    { price: 'ten', message: 'Enter a price in dollars and cents, like 12.99' },
    { price: '10.999', message: 'Enter a price in dollars and cents, like 12.99' },
    { price: '-5', message: 'Enter a price in dollars and cents, like 12.99' },
    { price: '1,000', message: 'Enter a price in dollars and cents, like 12.99' },
    { price: '1e3', message: 'Enter a price in dollars and cents, like 12.99' },
    { price: '', message: 'Price is required' },
    { price: '1000.01', message: 'Price must be at most $1,000.00' },
  ])('rejects the price $price with "$message" and sends nothing', async ({ price, message }) => {
    const fetchSpy = fakeApi();
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a topping' });

    await fill(user, form, { Name: 'Jalapenos', Price: price });
    await user.click(within(form).getByRole('button', { name: 'Add topping' }));

    const priceField = within(form).getByLabelText('Price');
    expect(priceField).toHaveAttribute('aria-invalid', 'true');
    expect(priceField).toHaveAccessibleDescription(message);
    expect(priceField).toHaveFocus();
    expect(within(form).getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('checks every field with the server rules before sending, and drops a message when its field changes', async () => {
    const fetchSpy = fakeApi();
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a menu item' });

    await fill(user, form, {
      Name: '   ',
      Category: 'c'.repeat(41),
      Price: '12.99',
      'Description (optional)': 'd'.repeat(501),
    });
    await user.click(within(form).getByRole('button', { name: 'Add menu item' }));

    const name = within(form).getByLabelText('Name');
    const category = within(form).getByLabelText('Category');
    const price = within(form).getByLabelText('Price');
    const description = within(form).getByLabelText('Description (optional)');
    expect(name).toHaveAccessibleDescription('Name is required');
    expect(category).toHaveAccessibleDescription('Category must be at most 40 characters');
    expect(description).toHaveAccessibleDescription('Description must be at most 500 characters');
    expect(price).not.toHaveAttribute('aria-invalid');
    expect(name).toHaveFocus();
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await user.type(name, 'Truffle Shuffle');

    expect(name).not.toHaveAttribute('aria-invalid');
    expect(within(form).queryByText('Name is required')).not.toBeInTheDocument();
    expect(category).toHaveAttribute('aria-invalid', 'true');
  });

  it('accepts every field at its limits', async () => {
    const longest = {
      ...truffle,
      name: 'n'.repeat(80),
      category: 'c'.repeat(40),
      description: 'd'.repeat(500),
      basePriceCents: 100_000,
    };
    const fetchSpy = fakeApi({
      [`POST ${MENU_ITEMS}`]: [jsonResponse(longest, 201)],
      [`GET ${MENU_ITEMS}`]: [jsonResponse(menuItems), jsonResponse([...menuItems, longest])],
    });
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a menu item' });

    await fill(user, form, {
      Name: ` ${'n'.repeat(80)} `,
      Category: 'c'.repeat(40),
      Price: '1000.00',
      'Description (optional)': 'd'.repeat(500),
    });
    await user.click(within(form).getByRole('button', { name: 'Add menu item' }));

    expect(await within(section('Menu items')).findByText(`Added ${longest.name}.`)).toBeVisible();
    expect(bodiesSent(fetchSpy, `POST ${MENU_ITEMS}`)).toEqual([
      {
        name: longest.name,
        description: longest.description,
        category: longest.category,
        basePriceCents: 100_000,
      },
    ]);
  });

  it("shows the server's VALIDATION_ERROR issues next to their fields", async () => {
    fakeApi({
      [`POST ${MENU_ITEMS}`]: [
        errorResponse(400, 'VALIDATION_ERROR', 'Request validation failed', {
          issues: [
            { path: 'category', message: 'Category must be at most 40 characters' },
            { path: 'basePriceCents', message: 'Price must be from 0 to 100000 cents' },
          ],
        }),
      ],
    });
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a menu item' });

    await fill(user, form, { Name: 'Truffle Shuffle', Category: 'Specialty', Price: '17.99' });
    await user.click(within(form).getByRole('button', { name: 'Add menu item' }));

    const category = within(form).getByLabelText('Category');
    expect(await within(form).findByText('Category must be at most 40 characters')).toBeVisible();
    expect(category).toHaveAccessibleDescription('Category must be at most 40 characters');
    expect(within(form).getByLabelText('Price')).toHaveAccessibleDescription(
      'Price must be from 0 to 100000 cents',
    );
    expect(within(form).getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    expect(category).toHaveFocus();
    expect(category).toHaveValue('Specialty');
    expect(within(form).getByRole('button', { name: 'Add menu item' })).toBeEnabled();
  });

  it('shows an issue for a field the form does not have above the buttons', async () => {
    fakeApi({
      [`POST ${TOPPINGS}`]: [
        errorResponse(400, 'VALIDATION_ERROR', 'Request validation failed', {
          issues: [{ path: 'available', message: 'Invalid input: expected boolean' }],
        }),
      ],
    });
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a topping' });

    await fill(user, form, { Name: 'Jalapenos', Price: '1.25' });
    await user.click(within(form).getByRole('button', { name: 'Add topping' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('Request validation failed');
    expect(within(form).getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(within(form).getByLabelText('Price')).not.toHaveAttribute('aria-invalid');
  });

  it('shows a taken name next to the name field and loads the list again (409 CONFLICT)', async () => {
    const othersTruffle = { ...truffle, id: 11 };
    const fetchSpy = fakeApi({
      [`POST ${MENU_ITEMS}`]: [conflict('A menu item with this name already exists')],
      [`GET ${MENU_ITEMS}`]: [jsonResponse(menuItems), jsonResponse([...menuItems, othersTruffle])],
    });
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a menu item' });

    await fill(user, form, { Name: 'truffle shuffle', Category: 'Specialty', Price: '17.99' });
    await user.click(within(form).getByRole('button', { name: 'Add menu item' }));

    const name = within(form).getByLabelText('Name');
    expect(
      await within(form).findByText('A menu item with this name already exists'),
    ).toBeVisible();
    expect(name).toHaveAccessibleDescription('A menu item with this name already exists');
    expect(name).toHaveFocus();
    expect(name).toHaveValue('truffle shuffle');
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    const menu = section('Menu items');
    expect(await within(menu).findByRole('listitem', { name: 'Truffle Shuffle' })).toBeVisible();
    expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(2);
    expect(within(menu).queryByText(/^Added/)).not.toBeInTheDocument();
  });

  it('shows a failure that is not about a field above the buttons, and keeps what was typed for another try', async () => {
    const fetchSpy = fakeApi({
      [`POST ${TOPPINGS}`]: [
        new TypeError('Failed to fetch'),
        jsonResponse({ id: 13, name: 'Jalapenos', priceCents: 125, available: true }, 201),
      ],
      [`GET ${TOPPINGS}`]: [jsonResponse(toppings), jsonResponse(toppings)],
    });
    const user = await renderLoadedPage();
    const form = screen.getByRole('form', { name: 'Add a topping' });

    await fill(user, form, { Name: 'Jalapenos', Price: '1.25' });
    await user.click(within(form).getByRole('button', { name: 'Add topping' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent(
      "Can't reach the server. Check your connection and try again.",
    );
    expect(within(form).getByLabelText('Name')).toHaveValue('Jalapenos');
    expect(within(form).getByLabelText('Price')).toHaveValue('1.25');
    const submit = within(form).getByRole('button', { name: 'Add topping' });
    expect(submit).toBeEnabled();
    expect(submit).toHaveFocus();
    expect(requestCount(fetchSpy, `GET ${TOPPINGS}`)).toBe(1);

    await user.click(submit);

    expect(await within(section('Toppings')).findByText('Added Jalapenos.')).toBeVisible();
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    expect(bodiesSent(fetchSpy, `POST ${TOPPINGS}`)).toEqual([
      { name: 'Jalapenos', priceCents: 125 },
      { name: 'Jalapenos', priceCents: 125 },
    ]);
  });
});

describe('StaffMenuPage edit', () => {
  it('edits a menu item inline, sending only the fields that changed', async () => {
    const patch = pendingResponse();
    const repriced = { ...margherita, basePriceCents: 1149 };
    const fetchSpy = fakeApi({
      [`PATCH ${MENU_ITEMS}/2`]: [patch.promise],
      [`GET ${MENU_ITEMS}`]: [jsonResponse(menuItems), jsonResponse([cheese, repriced, hawaiian])],
    });
    const user = await renderLoadedPage();

    await user.click(screen.getByRole('button', { name: 'Edit Margherita' }));

    const editor = screen.getByRole('form', { name: 'Edit Margherita' });
    expect(within(editor).getByLabelText('Name')).toHaveValue('Margherita');
    expect(within(editor).getByLabelText('Name')).toHaveFocus();
    expect(within(editor).getByLabelText('Category')).toHaveValue('Classic');
    expect(within(editor).getByLabelText('Price')).toHaveValue('10.99');
    expect(within(editor).getByLabelText('Description (optional)')).toHaveValue(
      margherita.description,
    );

    await fill(user, editor, { Price: '11.49' });
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));

    expect(within(editor).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(editor).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(bodiesSent(fetchSpy, `PATCH ${MENU_ITEMS}/2`)).toEqual([{ basePriceCents: 1149 }]);

    patch.send(jsonResponse(repriced));

    const menu = section('Menu items');
    expect(await within(menu).findByText('Saved Margherita.')).toBeVisible();
    expect(screen.queryByRole('form', { name: 'Edit Margherita' })).not.toBeInTheDocument();
    const margheritaRow = row('Menu items', 'Margherita');
    expect(within(margheritaRow).getByText('Classic · $11.49')).toBeInTheDocument();
    expect(within(margheritaRow).getByRole('button', { name: 'Edit Margherita' })).toHaveFocus();
    await waitFor(() => expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(2));
    expect(within(row('Menu items', 'Margherita')).getByText('Classic · $11.49')).toBeVisible();
  });

  it('edits a topping, sending its new name and price', async () => {
    const renamed = { ...mushrooms, name: 'Wild Mushrooms', priceCents: 175 };
    const fetchSpy = fakeApi({
      [`PATCH ${TOPPINGS}/7`]: [jsonResponse(renamed)],
      [`GET ${TOPPINGS}`]: [jsonResponse(toppings), jsonResponse([bacon, pineapple, renamed])],
    });
    const user = await renderLoadedPage();

    await user.click(screen.getByRole('button', { name: 'Edit Mushrooms' }));
    const editor = screen.getByRole('form', { name: 'Edit Mushrooms' });
    expect(within(editor).getByLabelText('Price')).toHaveValue('1.50');
    await fill(user, editor, { Name: 'Wild Mushrooms', Price: '1.75' });
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));

    expect(await within(section('Toppings')).findByText('Saved Wild Mushrooms.')).toBeVisible();
    expect(within(row('Toppings', 'Wild Mushrooms')).getByText('$1.75')).toBeVisible();
    expect(bodiesSent(fetchSpy, `PATCH ${TOPPINGS}/7`)).toEqual([
      { name: 'Wild Mushrooms', priceCents: 175 },
    ]);
  });

  it('cancels an edit without sending anything', async () => {
    const fetchSpy = fakeApi();
    const user = await renderLoadedPage();

    await user.click(screen.getByRole('button', { name: 'Edit Cheese' }));
    const editor = screen.getByRole('form', { name: 'Edit Cheese' });
    await fill(user, editor, { Name: 'Four Cheese' });
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('form', { name: 'Edit Cheese' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Cheese' })).toHaveFocus();
    expect(screen.queryByText('Four Cheese')).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Edit Cheese' }));

    expect(
      within(screen.getByRole('form', { name: 'Edit Cheese' })).getByLabelText('Name'),
    ).toHaveValue('Cheese');
  });

  it('closes the editor without a request when nothing really changed', async () => {
    const fetchSpy = fakeApi();
    const user = await renderLoadedPage();

    await user.click(screen.getByRole('button', { name: 'Edit Cheese' }));
    const editor = screen.getByRole('form', { name: 'Edit Cheese' });
    await fill(user, editor, { Name: ' Cheese ', Price: '$9.99' });
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByRole('form', { name: 'Edit Cheese' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Cheese' })).toHaveFocus();
    expect(within(section('Menu items')).queryByText(/^Saved/)).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('checks an edit with the server rules before sending', async () => {
    const fetchSpy = fakeApi();
    const user = await renderLoadedPage();

    await user.click(screen.getByRole('button', { name: 'Edit Bacon' }));
    const editor = screen.getByRole('form', { name: 'Edit Bacon' });
    await fill(user, editor, { Price: '2.505' });
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));

    const price = within(editor).getByLabelText('Price');
    expect(price).toHaveAccessibleDescription('Enter a price in dollars and cents, like 12.99');
    expect(price).toHaveFocus();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the editor open with the error when the new name is taken, and loads the list again', async () => {
    const fetchSpy = fakeApi({
      [`PATCH ${MENU_ITEMS}/2`]: [conflict('A menu item with this name already exists')],
      [`GET ${MENU_ITEMS}`]: [jsonResponse(menuItems), jsonResponse(menuItems)],
    });
    const user = await renderLoadedPage();

    await user.click(screen.getByRole('button', { name: 'Edit Margherita' }));
    const editor = screen.getByRole('form', { name: 'Edit Margherita' });
    await fill(user, editor, { Name: 'CHEESE' });
    await user.click(within(editor).getByRole('button', { name: 'Save changes' }));

    const name = within(editor).getByLabelText('Name');
    expect(
      await within(editor).findByText('A menu item with this name already exists'),
    ).toBeVisible();
    expect(name).toHaveAccessibleDescription('A menu item with this name already exists');
    expect(name).toHaveValue('CHEESE');
    expect(name).toHaveFocus();
    expect(within(editor).getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(bodiesSent(fetchSpy, `PATCH ${MENU_ITEMS}/2`)).toEqual([{ name: 'CHEESE' }]);
    await waitFor(() => expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(2));
    expect(screen.getByRole('form', { name: 'Edit Margherita' })).toBeInTheDocument();
  });
});

describe('StaffMenuPage hide and show', () => {
  it('hides a row from customers and shows it again, disabling the toggle while it saves', async () => {
    const hide = pendingResponse();
    const hiddenCheese = { ...cheese, available: false };
    const fetchSpy = fakeApi({
      [`PATCH ${MENU_ITEMS}/1`]: [hide.promise, jsonResponse(cheese)],
      [`GET ${MENU_ITEMS}`]: [
        jsonResponse(menuItems),
        jsonResponse([hiddenCheese, margherita, hawaiian]),
        jsonResponse(menuItems),
      ],
    });
    const user = await renderLoadedPage();
    const menu = section('Menu items');
    const cheeseRow = row('Menu items', 'Cheese');

    await user.click(within(cheeseRow).getByRole('button', { name: 'Hide Cheese' }));

    expect(within(cheeseRow).getByRole('button', { name: 'Hiding… Cheese' })).toBeDisabled();
    expect(bodiesSent(fetchSpy, `PATCH ${MENU_ITEMS}/1`)).toEqual([{ available: false }]);

    hide.send(jsonResponse(hiddenCheese));

    expect(await within(menu).findByText('Cheese is now hidden from customers.')).toBeVisible();
    expect(within(cheeseRow).getByText('Hidden')).toBeInTheDocument();
    const show = within(cheeseRow).getByRole('button', { name: 'Show Cheese' });
    expect(show).toBeEnabled();
    expect(show).toHaveFocus();
    await waitFor(() => expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(2));

    await user.click(show);

    expect(await within(menu).findByText('Cheese is visible to customers again.')).toBeVisible();
    expect(within(cheeseRow).queryByText('Hidden')).not.toBeInTheDocument();
    expect(within(cheeseRow).getByRole('button', { name: 'Hide Cheese' })).toBeEnabled();
    expect(bodiesSent(fetchSpy, `PATCH ${MENU_ITEMS}/1`)).toEqual([
      { available: false },
      { available: true },
    ]);
    await waitFor(() => expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(3));
  });

  it('shows a toppings row again for customers', async () => {
    const shown = { ...pineapple, available: true };
    const fetchSpy = fakeApi({
      [`PATCH ${TOPPINGS}/9`]: [jsonResponse(shown)],
      [`GET ${TOPPINGS}`]: [jsonResponse(toppings), jsonResponse([bacon, mushrooms, shown])],
    });
    const user = await renderLoadedPage();

    await user.click(screen.getByRole('button', { name: 'Show Pineapple' }));

    expect(
      await within(section('Toppings')).findByText('Pineapple is visible to customers again.'),
    ).toBeVisible();
    expect(within(row('Toppings', 'Pineapple')).queryByText('Hidden')).not.toBeInTheDocument();
    expect(bodiesSent(fetchSpy, `PATCH ${TOPPINGS}/9`)).toEqual([{ available: true }]);
  });

  it('shows a failed hide under its row and lets staff try again', async () => {
    const fetchSpy = fakeApi({
      [`PATCH ${MENU_ITEMS}/1`]: [
        errorResponse(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'),
      ],
    });
    const user = await renderLoadedPage();
    const cheeseRow = row('Menu items', 'Cheese');

    await user.click(within(cheeseRow).getByRole('button', { name: 'Hide Cheese' }));

    expect(await within(cheeseRow).findByRole('alert')).toHaveTextContent(
      "Couldn't hide Cheese. Something went wrong. Please try again.",
    );
    expect(within(cheeseRow).queryByText('Hidden')).not.toBeInTheDocument();
    const hide = within(cheeseRow).getByRole('button', { name: 'Hide Cheese' });
    expect(hide).toBeEnabled();
    expect(hide).toHaveFocus();
    expect(within(section('Menu items')).queryByText(/hidden from customers/)).toBeNull();
    expect(requestCount(fetchSpy, `GET ${MENU_ITEMS}`)).toBe(1);
  });

  it('shows a 404 under the row, without loading the list again', async () => {
    const fetchSpy = fakeApi({
      [`PATCH ${TOPPINGS}/7`]: [errorResponse(404, 'NOT_FOUND', 'Topping not found')],
    });
    const user = await renderLoadedPage();
    const mushroomsRow = row('Toppings', 'Mushrooms');

    await user.click(within(mushroomsRow).getByRole('button', { name: 'Hide Mushrooms' }));

    expect(await within(mushroomsRow).findByRole('alert')).toHaveTextContent(
      "Couldn't hide Mushrooms. Topping not found",
    );
    expect(requestCount(fetchSpy, `GET ${TOPPINGS}`)).toBe(1);
  });

  it('keeps the saved row on screen and offers a retry when the reload after a save fails', async () => {
    const hiddenBacon = { ...bacon, available: false };
    const fetchSpy = fakeApi({
      [`PATCH ${TOPPINGS}/1`]: [jsonResponse(hiddenBacon)],
      [`GET ${TOPPINGS}`]: [
        jsonResponse(toppings),
        new TypeError('Failed to fetch'),
        jsonResponse([hiddenBacon, mushrooms, pineapple]),
      ],
    });
    const user = await renderLoadedPage();
    const toppingSection = section('Toppings');

    await user.click(screen.getByRole('button', { name: 'Hide Bacon' }));

    expect(
      await within(toppingSection).findByText(/Couldn't refresh the toppings\./),
    ).toBeVisible();
    expect(within(toppingSection).getByText('Bacon is now hidden from customers.')).toBeVisible();
    expect(within(row('Toppings', 'Bacon')).getByText('Hidden')).toBeInTheDocument();
    expect(within(row('Toppings', 'Mushrooms')).queryByText('Hidden')).not.toBeInTheDocument();

    await user.click(within(toppingSection).getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(within(toppingSection).queryByText(/Couldn't refresh/)).not.toBeInTheDocument(),
    );
    expect(within(row('Toppings', 'Bacon')).getByText('Hidden')).toBeInTheDocument();
    expect(requestCount(fetchSpy, `GET ${TOPPINGS}`)).toBe(3);
  });
});
