import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CART_STORAGE_KEY, useCart, type CartItemInput } from '../context/CartContext';
import { renderWithProviders } from '../test/render';
import { Layout } from './Layout';

const margherita: CartItemInput = {
  menuItem: { id: 2, name: 'Margherita', basePriceCents: 1099 },
  size: { id: 2, name: 'Medium', priceMultiplier: 1.25 },
  crust: { id: 1, name: 'Hand-Tossed', priceDeltaCents: 0 },
  toppings: [],
  quantity: 1,
};

/** Stands in for the pizza builder: adds pizzas from inside the layout. */
function AddButtons() {
  const { addItem } = useCart();
  return (
    <>
      <button type="button" onClick={() => addItem(margherita)}>
        Add one
      </button>
      <button
        type="button"
        onClick={() => addItem({ ...margherita, size: { ...margherita.size, id: 3 }, quantity: 2 })}
      >
        Add two more
      </button>
    </>
  );
}

function renderLayout() {
  renderWithProviders(
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AddButtons />} />
      </Route>
    </Routes>,
  );
  return within(screen.getByRole('navigation', { name: 'Main' }));
}

describe('Layout cart link', () => {
  it('names an empty cart and shows no count', () => {
    const nav = renderLayout();

    const link = nav.getByRole('link', { name: 'Cart, empty' });
    expect(link).toHaveAttribute('href', '/cart');
    expect(link).toHaveTextContent(/^Cart$/);
  });

  it('shows the number of pizzas and puts it in the link name', async () => {
    const user = userEvent.setup();
    const nav = renderLayout();

    await user.click(screen.getByRole('button', { name: 'Add one' }));
    const one = nav.getByRole('link', { name: 'Cart, 1 item' });
    expect(within(one).getByText('1')).toHaveAttribute('aria-hidden', 'true');

    await user.click(screen.getByRole('button', { name: 'Add two more' }));
    const three = nav.getByRole('link', { name: 'Cart, 3 items' });
    expect(three).toHaveTextContent(/^Cart3$/);
  });

  it('counts a saved cart from the first render', () => {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([
        {
          lineId: 'line-1',
          menuItemId: 2,
          sizeId: 2,
          crustId: 1,
          toppingIds: [],
          quantity: 4,
          display: {
            menuItemName: 'Margherita',
            sizeName: 'Medium',
            crustName: 'Hand-Tossed',
            toppingNames: [],
            unitPriceCents: 1374,
          },
        },
      ]),
    );

    const nav = renderLayout();

    expect(nav.getByRole('link', { name: 'Cart, 4 items' })).toHaveTextContent(/^Cart4$/);
  });
});
