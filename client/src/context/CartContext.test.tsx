import { MAX_QUANTITY_PER_ITEM, MAX_TOPPINGS_PER_ITEM } from '@fired-up-pizza/shared/pricing';
import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CART_STORAGE_KEY,
  CartProvider,
  useCart,
  type CartItemInput,
  type CartLineItem,
} from './CartContext';

// Catalog rows as the API returns them for the seeded catalog (server/src/db/seed.ts).
const cheese = { id: 1, name: 'Cheese', basePriceCents: 999 };
const margherita = { id: 2, name: 'Margherita', basePriceCents: 1099 };
const pepperoniPizza = { id: 3, name: 'Pepperoni', basePriceCents: 1299 };
const small = { id: 1, name: 'Small', priceMultiplier: 1 };
const medium = { id: 2, name: 'Medium', priceMultiplier: 1.25 };
const large = { id: 3, name: 'Large', priceMultiplier: 1.5 };
const handTossed = { id: 1, name: 'Hand-Tossed', priceDeltaCents: 0 };
const stuffedCrust = { id: 3, name: 'Stuffed Crust', priceDeltaCents: 200 };
const toppings = {
  pepperoni: { id: 1, name: 'Pepperoni', priceCents: 200 },
  italianSausage: { id: 2, name: 'Italian Sausage', priceCents: 200 },
  bacon: { id: 3, name: 'Bacon', priceCents: 200 },
  ham: { id: 4, name: 'Ham', priceCents: 200 },
  grilledChicken: { id: 5, name: 'Grilled Chicken', priceCents: 250 },
  extraCheese: { id: 6, name: 'Extra Cheese', priceCents: 150 },
  mushrooms: { id: 7, name: 'Mushrooms', priceCents: 150 },
  greenPeppers: { id: 8, name: 'Green Peppers', priceCents: 150 },
  redOnions: { id: 9, name: 'Red Onions', priceCents: 125 },
  blackOlives: { id: 10, name: 'Black Olives', priceCents: 150 },
  pineapple: { id: 11, name: 'Pineapple', priceCents: 150 },
  freshBasil: { id: 12, name: 'Fresh Basil', priceCents: 100 },
};
const { mushrooms, freshBasil } = toppings;

/** round(1099 × 1.25) = 1374, + 200 crust + 150 + 100 toppings = 1824 cents each. */
const margheritaInput: CartItemInput = {
  menuItem: margherita,
  size: medium,
  crust: stuffedCrust,
  toppings: [mushrooms, freshBasil],
  quantity: 2,
};

/** round(1299 × 1.5) = 1948.5 rounded half up = 1949 cents each, nothing added. */
const pepperoniInput: CartItemInput = {
  menuItem: pepperoniPizza,
  size: large,
  crust: handTossed,
  toppings: [],
  quantity: 1,
};

/** The line margheritaInput adds, as it is stored. */
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

function renderCart() {
  return renderHook(() => useCart(), { wrapper: CartProvider });
}

function storedCart(): unknown {
  const stored = localStorage.getItem(CART_STORAGE_KEY);
  return stored === null ? null : JSON.parse(stored);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CartProvider', () => {
  it('starts with an empty cart', () => {
    const { result } = renderCart();

    expect(result.current).toMatchObject({ items: [], itemCount: 0, estimatedTotalCents: 0 });
  });

  it('adds a line with the selected ids and a display snapshot priced by the shared formula', () => {
    const { result } = renderCart();

    act(() => result.current.addItem(margheritaInput));

    expect(result.current.items).toEqual([{ ...margheritaLine, lineId: expect.any(String) }]);
    expect(result.current.itemCount).toBe(2);
    expect(result.current.estimatedTotalCents).toBe(3648);
  });

  it('keeps lines in the order they were added, each with its own id', () => {
    const { result } = renderCart();

    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));

    const [first, second] = result.current.items;
    expect(first?.display.menuItemName).toBe('Margherita');
    expect(second).toEqual({
      lineId: expect.any(String),
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
    });
    expect(first?.lineId).not.toBe(second?.lineId);
  });

  it('counts pizzas and estimates the total across lines', () => {
    const { result } = renderCart();

    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));

    expect(result.current.itemCount).toBe(3);
    // 2 × 1824 + 1 × 1949
    expect(result.current.estimatedTotalCents).toBe(5597);
  });

  it('adds the same selections to the existing line, taking the newer snapshot', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));
    const lineId = result.current.items[0]?.lineId;

    // Same toppings in another order, after basil went up to 125 cents.
    act(() =>
      result.current.addItem({
        ...margheritaInput,
        toppings: [{ ...freshBasil, priceCents: 125 }, mushrooms],
        quantity: 3,
      }),
    );

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]).toEqual({
      ...margheritaLine,
      lineId,
      toppingIds: [12, 7],
      quantity: 5,
      display: {
        ...margheritaLine.display,
        toppingNames: ['Fresh Basil', 'Mushrooms'],
        unitPriceCents: 1849,
      },
    });
  });

  it.each([
    { name: 'a different size', change: { size: large } },
    { name: 'a different crust', change: { crust: handTossed } },
    { name: 'one topping fewer', change: { toppings: [mushrooms] } },
    { name: 'one topping more', change: { toppings: [mushrooms, freshBasil, toppings.ham] } },
  ])('adds a separate line for $name', ({ change }) => {
    const { result } = renderCart();

    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem({ ...margheritaInput, ...change }));

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items.map((item) => item.quantity)).toEqual([2, 2]);
  });

  it.each([
    { quantity: 0, expected: 1 },
    { quantity: -2, expected: 1 },
    { quantity: 2.7, expected: 2 },
    { quantity: Number.NaN, expected: 1 },
    { quantity: MAX_QUANTITY_PER_ITEM + 1, expected: MAX_QUANTITY_PER_ITEM },
    { quantity: Number.POSITIVE_INFINITY, expected: MAX_QUANTITY_PER_ITEM },
  ])('clamps an added quantity of $quantity to $expected', ({ quantity, expected }) => {
    const { result } = renderCart();

    act(() => result.current.addItem({ ...margheritaInput, quantity }));

    expect(result.current.items[0]?.quantity).toBe(expected);
  });

  it('clamps the quantity of a line that the same selections are added to', () => {
    const { result } = renderCart();

    act(() => result.current.addItem({ ...margheritaInput, quantity: 15 }));
    act(() => result.current.addItem({ ...margheritaInput, quantity: 10 }));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.quantity).toBe(MAX_QUANTITY_PER_ITEM);
  });

  it('counts a topping listed twice once', () => {
    const { result } = renderCart();

    act(() =>
      result.current.addItem({ ...margheritaInput, toppings: [mushrooms, freshBasil, mushrooms] }),
    );

    expect(result.current.items[0]).toMatchObject({
      toppingIds: [7, 12],
      display: { toppingNames: ['Mushrooms', 'Fresh Basil'], unitPriceCents: 1824 },
    });
  });

  it('keeps only the first MAX_TOPPINGS_PER_ITEM toppings and prices just those', () => {
    const { result } = renderCart();
    const all = Object.values(toppings);
    expect(all.length).toBeGreaterThan(MAX_TOPPINGS_PER_ITEM);

    act(() =>
      result.current.addItem({
        menuItem: cheese,
        size: small,
        crust: handTossed,
        toppings: all,
        quantity: 1,
      }),
    );

    const kept = all.slice(0, MAX_TOPPINGS_PER_ITEM);
    expect(result.current.items[0]).toMatchObject({
      toppingIds: kept.map((topping) => topping.id),
      display: {
        toppingNames: kept.map((topping) => topping.name),
        // 999 + the first ten seeded toppings (1775); pineapple and basil are dropped.
        unitPriceCents: 2774,
      },
    });
  });

  it.each([
    { name: 'a menu item id of 0', change: { menuItem: { ...margherita, id: 0 } } },
    { name: 'a fractional size id', change: { size: { ...medium, id: 1.5 } } },
    { name: 'a negative crust id', change: { crust: { ...stuffedCrust, id: -3 } } },
    {
      name: 'a topping id that is not a whole number',
      change: { toppings: [{ ...mushrooms, id: 7.5 }] },
    },
    {
      name: 'a base price in dollars',
      change: { menuItem: { ...margherita, basePriceCents: 10.99 } },
    },
    { name: 'a zero size multiplier', change: { size: { ...medium, priceMultiplier: 0 } } },
    {
      name: 'a negative crust delta',
      change: { crust: { ...stuffedCrust, priceDeltaCents: -200 } },
    },
    {
      name: 'a topping price of NaN',
      change: { toppings: [{ ...mushrooms, priceCents: Number.NaN }] },
    },
  ])('throws a RangeError for $name and leaves the cart unchanged', ({ change }) => {
    const { result } = renderCart();
    act(() => result.current.addItem(pepperoniInput));
    const before = result.current.items;

    expect(() => result.current.addItem({ ...margheritaInput, ...change })).toThrow(RangeError);

    expect(result.current.items).toBe(before);
  });

  it.each([
    { quantity: 3, expected: 3 },
    { quantity: 0, expected: 1 },
    { quantity: 4.9, expected: 4 },
    { quantity: Number.NaN, expected: 1 },
    { quantity: 50, expected: MAX_QUANTITY_PER_ITEM },
  ])('sets a line quantity of $quantity as $expected', ({ quantity, expected }) => {
    const { result } = renderCart();
    act(() => result.current.addItem({ ...margheritaInput, quantity: 6 }));
    act(() => result.current.addItem(pepperoniInput));
    const [margheritaItem, pepperoniItem] = result.current.items;

    act(() => result.current.updateQuantity(margheritaItem?.lineId ?? '', quantity));

    expect(result.current.items).toEqual([
      { ...margheritaItem, quantity: expected },
      pepperoniItem,
    ]);
  });

  it('updates the count and estimate when a quantity changes', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    const lineId = result.current.items[0]?.lineId ?? '';

    act(() => result.current.updateQuantity(lineId, 4));

    expect(result.current.itemCount).toBe(4);
    expect(result.current.estimatedTotalCents).toBe(4 * 1824);
  });

  it('removes one line and keeps the rest', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));
    const [margheritaItem, pepperoniItem] = result.current.items;

    act(() => result.current.removeItem(margheritaItem?.lineId ?? ''));

    expect(result.current.items).toEqual([pepperoniItem]);
    expect(result.current.itemCount).toBe(1);
    expect(result.current.estimatedTotalCents).toBe(1949);
  });

  it('ignores updates and removals for a line that is not in the cart', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    const before = result.current.items;

    act(() => result.current.updateQuantity('no-such-line', 3));
    act(() => result.current.removeItem('no-such-line'));

    expect(result.current.items).toBe(before);
  });

  it('gives a new line an id that no remaining line uses', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));
    act(() => result.current.removeItem(result.current.items[0]?.lineId ?? ''));

    act(() => result.current.addItem({ ...margheritaInput, size: small }));

    const lineIds = result.current.items.map((item) => item.lineId);
    expect(new Set(lineIds).size).toBe(2);
  });

  it('clears every line', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));

    act(() => result.current.clear());

    expect(result.current).toMatchObject({ items: [], itemCount: 0, estimatedTotalCents: 0 });
  });

  it('keeps the same action functions across changes, so they are safe effect dependencies', () => {
    const { result } = renderCart();
    const { addItem, updateQuantity, removeItem, clear } = result.current;

    act(() => result.current.addItem(margheritaInput));

    expect(result.current).toMatchObject({ addItem, updateQuantity, removeItem, clear });
  });

  it('applies each action once under StrictMode, which runs reducers twice in development', () => {
    // main.tsx renders the app in StrictMode; the test render helpers do not.
    const { result } = renderHook(() => useCart(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>
          <CartProvider>{children}</CartProvider>
        </StrictMode>
      ),
    });

    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));
    act(() => result.current.updateQuantity(result.current.items[1]?.lineId ?? '', 3));

    expect(result.current.items.map((item) => item.quantity)).toEqual([4, 3]);
    expect(storedCart()).toEqual(result.current.items);
  });
});

describe('useCart', () => {
  it('explains that it needs a CartProvider', () => {
    // Before rethrowing a render error, React in development logs it and also
    // raises it as an uncaught error event, which jsdom prints. Silence both.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const silence = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', silence);
    try {
      expect(() => renderHook(() => useCart())).toThrow(
        'useCart must be used inside <CartProvider>',
      );
    } finally {
      window.removeEventListener('error', silence);
    }
  });
});

describe('cart persistence', () => {
  it(`saves the lines to localStorage under ${CART_STORAGE_KEY}`, () => {
    const { result } = renderCart();

    act(() => result.current.addItem(margheritaInput));

    expect(storedCart()).toEqual(result.current.items);
  });

  it('restores the saved cart in a new provider', () => {
    const first = renderCart();
    act(() => first.result.current.addItem(margheritaInput));
    act(() => first.result.current.addItem(pepperoniInput));
    const saved = first.result.current;
    first.unmount();

    const { result } = renderCart();

    expect(result.current.items).toEqual(saved.items);
    expect(result.current.itemCount).toBe(3);
    expect(result.current.estimatedTotalCents).toBe(5597);
  });

  it('restores a cart saved in the stored format', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([margheritaLine]));

    const { result } = renderCart();

    expect(result.current.items).toEqual([margheritaLine]);
  });

  it('does not write back a cart it has just restored', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([margheritaLine]));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    renderCart();

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('saves each change', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([margheritaLine]));
    const { result } = renderCart();

    act(() => result.current.updateQuantity('line-1', 7));

    expect(storedCart()).toEqual([{ ...margheritaLine, quantity: 7 }]);
  });

  it('removes the saved cart once the cart is empty', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([margheritaLine]));
    const { result } = renderCart();

    act(() => result.current.clear());

    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('drops unknown keys from a saved line', () => {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify([
        { ...margheritaLine, priceCents: 1, display: { ...margheritaLine.display, extra: 'x' } },
      ]),
    );

    const { result } = renderCart();

    expect(result.current.items).toEqual([margheritaLine]);
  });

  /** The saved margherita line with some fields replaced (undefined drops a field). */
  function savedWith(change: Record<string, unknown>): string {
    return JSON.stringify([{ ...margheritaLine, ...change }]);
  }

  function savedWithDisplay(change: Record<string, unknown>): string {
    return savedWith({ display: { ...margheritaLine.display, ...change } });
  }

  it.each([
    { name: 'text that is not JSON', stored: '[{"lineId":' },
    { name: 'JSON that is not a list', stored: JSON.stringify({ items: [margheritaLine] }) },
    { name: 'JSON null', stored: 'null' },
    { name: 'a list holding a number', stored: '[42]' },
    { name: 'an empty lineId', stored: savedWith({ lineId: '' }) },
    { name: 'no lineId', stored: savedWith({ lineId: undefined }) },
    { name: 'a menu item id given as text', stored: savedWith({ menuItemId: '2' }) },
    { name: 'a size id of 0', stored: savedWith({ sizeId: 0 }) },
    { name: 'a fractional crust id', stored: savedWith({ crustId: 1.5 }) },
    { name: 'topping ids that are not a list', stored: savedWith({ toppingIds: 7 }) },
    { name: 'a negative topping id', stored: savedWith({ toppingIds: [7, -12] }) },
    { name: 'a repeated topping', stored: savedWith({ toppingIds: [7, 7] }) },
    {
      name: 'more than MAX_TOPPINGS_PER_ITEM toppings',
      stored: savedWith({
        toppingIds: Array.from({ length: MAX_TOPPINGS_PER_ITEM + 1 }, (_, index) => index + 1),
        display: {
          ...margheritaLine.display,
          toppingNames: Array.from({ length: MAX_TOPPINGS_PER_ITEM + 1 }, () => 'Topping'),
        },
      }),
    },
    { name: 'a quantity of 0', stored: savedWith({ quantity: 0 }) },
    {
      name: 'a quantity over the limit',
      stored: savedWith({ quantity: MAX_QUANTITY_PER_ITEM + 1 }),
    },
    { name: 'a fractional quantity', stored: savedWith({ quantity: 2.5 }) },
    { name: 'a quantity given as text', stored: savedWith({ quantity: '2' }) },
    { name: 'no display', stored: savedWith({ display: undefined }) },
    { name: 'a display that is text', stored: savedWith({ display: 'Margherita' }) },
    { name: 'a menu item name that is not text', stored: savedWithDisplay({ menuItemName: 2 }) },
    { name: 'no size name', stored: savedWithDisplay({ sizeName: undefined }) },
    { name: 'no crust name', stored: savedWithDisplay({ crustName: undefined }) },
    {
      name: 'fewer topping names than ids',
      stored: savedWithDisplay({ toppingNames: ['Mushrooms'] }),
    },
    {
      name: 'a topping name that is not text',
      stored: savedWithDisplay({ toppingNames: ['Mushrooms', 12] }),
    },
    { name: 'a negative unit price', stored: savedWithDisplay({ unitPriceCents: -1824 }) },
    { name: 'a unit price in dollars', stored: savedWithDisplay({ unitPriceCents: 18.24 }) },
    { name: 'a unit price given as text', stored: savedWithDisplay({ unitPriceCents: '1824' }) },
    {
      name: 'a valid line next to an invalid one',
      stored: JSON.stringify([
        margheritaLine,
        { ...margheritaLine, lineId: 'line-2', quantity: 0 },
      ]),
    },
    {
      name: 'two lines with the same lineId',
      stored: JSON.stringify([margheritaLine, { ...margheritaLine, sizeId: 3 }]),
    },
    {
      // 2 × MAX_SAFE_INTEGER: computeLineTotalCents would throw while rendering.
      name: 'a line total past Number.MAX_SAFE_INTEGER',
      stored: savedWithDisplay({ unitPriceCents: Number.MAX_SAFE_INTEGER }),
    },
    {
      // Each line is 2^52 cents, so only their sum, 2^53, is past MAX_SAFE_INTEGER.
      name: 'an order total past Number.MAX_SAFE_INTEGER',
      stored: JSON.stringify(
        ['line-1', 'line-2'].map((lineId, index) => ({
          ...margheritaLine,
          lineId,
          sizeId: index + 1,
          quantity: 1,
          display: { ...margheritaLine.display, unitPriceCents: 2 ** 52 },
        })),
      ),
    },
  ])('treats $name as an empty cart and removes it', ({ stored }) => {
    localStorage.setItem(CART_STORAGE_KEY, stored);

    const { result } = renderCart();

    expect(result.current).toMatchObject({ items: [], itemCount: 0, estimatedTotalCents: 0 });
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('starts empty and keeps working when reading storage throws', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([margheritaLine]));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    const { result } = renderCart();
    expect(result.current.items).toEqual([]);

    act(() => result.current.addItem(pepperoniInput));
    expect(result.current.itemCount).toBe(1);
  });

  it('keeps working in memory when saving throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const { result } = renderCart();

    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.addItem(pepperoniInput));

    expect(result.current.itemCount).toBe(3);
    expect(localStorage.getItem(CART_STORAGE_KEY)).toBeNull();
  });

  it('works in memory when localStorage itself is blocked', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([margheritaLine]));
    const blocked = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    const { result } = renderCart();
    expect(result.current.items).toEqual([]);

    act(() => result.current.addItem(margheritaInput));
    act(() => result.current.clear());
    act(() => result.current.addItem(pepperoniInput));
    expect(result.current.itemCount).toBe(1);

    blocked.mockRestore();
    expect(storedCart()).toEqual([margheritaLine]);
  });
});

describe('cart changes from other tabs', () => {
  function storageEvent(init: StorageEventInit) {
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', init));
    });
  }

  it('takes the cart another tab saved, without writing it back', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(pepperoniInput));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    storageEvent({ key: CART_STORAGE_KEY, newValue: JSON.stringify([margheritaLine]) });

    expect(result.current.items).toEqual([margheritaLine]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('empties when another tab clears the cart, e.g. after placing the order', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));

    storageEvent({ key: CART_STORAGE_KEY, newValue: null });

    expect(result.current.items).toEqual([]);
  });

  it("empties when another tab clears all of the site's storage", () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));

    storageEvent({ key: null, newValue: null });

    expect(result.current.items).toEqual([]);
  });

  it('ignores changes to other keys', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    const before = result.current.items;

    storageEvent({ key: 'fired-up-pizza.phone', newValue: '+12125550142' });

    expect(result.current.items).toBe(before);
  });

  it('treats an invalid cart from another tab as empty and removes it', () => {
    const { result } = renderCart();
    act(() => result.current.addItem(margheritaInput));
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');

    storageEvent({ key: CART_STORAGE_KEY, newValue: '[{"lineId":' });

    expect(result.current.items).toEqual([]);
    expect(removeItem).toHaveBeenCalledExactlyOnceWith(CART_STORAGE_KEY);
  });

  it('stops listening when the provider unmounts', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderCart();

    unmount();

    expect(removeListener).toHaveBeenCalledWith('storage', expect.any(Function));
  });
});
