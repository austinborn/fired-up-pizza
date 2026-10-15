import type { MenuItem } from '@fired-up-pizza/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp, renderWithProviders } from '../../test/render';
import { MenuPage } from './MenuPage';

// The builder is another page's work. A stand-in that shows the route's id
// lets a test follow a menu link through the real route table.
vi.mock('./PizzaBuilderPage', async () => {
  const { useParams } = await import('react-router-dom');
  function PizzaBuilderPage() {
    const { menuItemId } = useParams();
    return <p>Builder for menu item {menuItemId}</p>;
  }
  return { PizzaBuilderPage };
});

const createdAt = '2026-10-14T23:41:39.000Z';

function menuItem(item: Omit<MenuItem, 'available' | 'createdAt'>): MenuItem {
  return { ...item, available: true, createdAt };
}

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
const hawaiian = menuItem({
  id: 4,
  name: 'Hawaiian',
  description: 'Tomato sauce, mozzarella, ham, and pineapple.',
  category: 'Specialty',
  basePriceCents: 1399,
});
const gardenVeggie = menuItem({
  id: 8,
  name: 'Garden Veggie',
  description: 'Mushrooms, green peppers, red onions, black olives, and tomatoes on mozzarella.',
  category: 'Veggie',
  basePriceCents: 1349,
});

/** The menu as GET /api/menu-items sends it: by category, then name. */
const menu = [cheese, margherita, hawaiian, gardenVeggie];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Each request gets the next answer. A request beyond the script fails as if the server were down. */
function scriptFetch(...answers: (Response | Error | Promise<Response>)[]) {
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('The test expected no more requests'));
  for (const answer of answers) {
    if (answer instanceof Error) {
      fetchSpy.mockRejectedValueOnce(answer);
    } else {
      fetchSpy.mockReturnValueOnce(Promise.resolve(answer));
    }
  }
  return fetchSpy;
}

/** A response the test sends when it chooses. */
function pendingResponse() {
  let send!: (response: Response) => void;
  const promise = new Promise<Response>((resolve) => {
    send = resolve;
  });
  return { promise, send };
}

/** Checks the pizzas listed under a category heading: their links' names, in page order. */
function expectCategory(category: string, linkNames: string[]) {
  const links = within(screen.getByRole('list', { name: category })).getAllByRole('link');
  expect(links).toHaveLength(linkNames.length);
  linkNames.forEach((name, index) => {
    expect(links[index]).toHaveAccessibleName(name);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MenuPage', () => {
  it('shows a loading state, then the pizzas under their categories in the order the server sends', async () => {
    const fetchSpy = scriptFetch(jsonResponse(menu));

    renderWithProviders(<MenuPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the menu…');

    const categories = await screen.findAllByRole('heading', { level: 2 });
    expect(categories.map((heading) => heading.textContent)).toEqual([
      'Classic',
      'Specialty',
      'Veggie',
    ]);
    expectCategory('Classic', ['Cheese from $9.99', 'Margherita from $10.99']);
    expectCategory('Specialty', ['Hawaiian from $13.99']);
    expectCategory('Veggie', ['Garden Veggie from $13.49']);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      '/api/menu-items',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('describes each pizza and prices it from its base price', async () => {
    scriptFetch(jsonResponse(menu));

    renderWithProviders(<MenuPage />);

    const link = await screen.findByRole('link', { name: 'Margherita from $10.99' });
    expect(link).toHaveAccessibleDescription(
      'San Marzano tomato sauce, fresh mozzarella, basil, and extra-virgin olive oil.',
    );
    expect(link).toHaveTextContent('from $10.99');
  });

  it('links each pizza to its builder page', async () => {
    scriptFetch(jsonResponse(menu));

    renderWithProviders(<MenuPage />);

    expect(await screen.findByRole('link', { name: 'Cheese from $9.99' })).toHaveAttribute(
      'href',
      '/menu/1',
    );
    expect(screen.getByRole('link', { name: 'Margherita from $10.99' })).toHaveAttribute(
      'href',
      '/menu/2',
    );
    expect(screen.getByRole('link', { name: 'Hawaiian from $13.99' })).toHaveAttribute(
      'href',
      '/menu/4',
    );
    expect(screen.getByRole('link', { name: 'Garden Veggie from $13.49' })).toHaveAttribute(
      'href',
      '/menu/8',
    );
  });

  it('opens the builder for the chosen pizza', async () => {
    scriptFetch(jsonResponse(menu));
    const user = userEvent.setup();

    renderApp('/');
    await user.click(await screen.findByRole('link', { name: 'Hawaiian from $13.99' }));

    expect(screen.getByText('Builder for menu item 4')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Menu' })).not.toBeInTheDocument();
  });

  it('keeps categories that differ only in case together, under the first spelling', async () => {
    const meatLovers = menuItem({
      id: 7,
      name: 'Meat Lovers',
      description: 'Pepperoni, Italian sausage, bacon, and ham.',
      category: 'specialty',
      basePriceCents: 1599,
    });
    scriptFetch(jsonResponse([hawaiian, meatLovers]));

    renderWithProviders(<MenuPage />);

    const categories = await screen.findAllByRole('heading', { level: 2 });
    expect(categories.map((heading) => heading.textContent)).toEqual(['Specialty']);
    expectCategory('Specialty', ['Hawaiian from $13.99', 'Meat Lovers from $15.99']);
  });

  it('shows a pizza without a description by its name and price alone', async () => {
    scriptFetch(jsonResponse([{ ...cheese, description: '' }]));

    renderWithProviders(<MenuPage />);

    const link = await screen.findByRole('link', { name: 'Cheese from $9.99' });
    expect(link).not.toHaveAttribute('aria-describedby');
    expect(link).not.toHaveAccessibleDescription();
  });

  it('says the menu is being updated when no pizza is available', async () => {
    scriptFetch(jsonResponse([]));

    renderWithProviders(<MenuPage />);

    expect(await screen.findByText('Our menu is being updated')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Our menu is being updated');
    expect(status).toHaveTextContent('Please check back soon.');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['the server cannot be reached', new TypeError('Failed to fetch'), "Can't reach the server."],
    [
      'the server fails',
      jsonResponse(
        { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
        500,
      ),
      'Something went wrong. Please try again.',
    ],
  ])('shows an error, not an empty menu, when %s', async (_case, answer, message) => {
    scriptFetch(answer);

    renderWithProviders(<MenuPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the menu");
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByText('Our menu is being updated')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('loads the menu again when "Try again" is pressed', async () => {
    const retry = pendingResponse();
    const fetchSpy = scriptFetch(new TypeError('Failed to fetch'), retry.promise);
    const user = userEvent.setup();

    renderWithProviders(<MenuPage />);
    await user.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Try again' }),
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the menu…');

    retry.send(jsonResponse(menu));

    expect(await screen.findByRole('link', { name: 'Cheese from $9.99' })).toBeInTheDocument();
    expectCategory('Classic', ['Cheese from $9.99', 'Margherita from $10.99']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/menu-items',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('cancels the request when the page closes before the menu arrives', () => {
    const fetchSpy = scriptFetch(pendingResponse().promise);

    const { unmount } = renderWithProviders(<MenuPage />);
    const signal = fetchSpy.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
