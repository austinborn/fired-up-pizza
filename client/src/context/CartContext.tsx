import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import {
  computeOrderTotalCents,
  computeUnitPriceCents,
  MAX_QUANTITY_PER_ITEM,
  MAX_TOPPINGS_PER_ITEM,
} from '@fired-up-pizza/shared/pricing';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// The customer's cart (ADR 0007 rule 1): React Context and useReducer, with no
// state library. Each line holds the customer's selections as catalog ids,
// which is all that checkout sends (ADR 0003 rule 3). It also holds a display
// snapshot taken when the line was added: names, and a unit price computed
// with the shared pricing formula. Those prices are estimates. The server
// prices the order again from the current catalog, and the confirmation shows
// the server's totals (ADR 0003 rule 5).
//
// The cart is saved to localStorage under CART_STORAGE_KEY and restored on the
// next visit:
// - Storage that is missing, is not JSON, or is not exactly what this module
//   writes counts as an empty cart. The bad value is removed.
// - Storage that throws (blocked by privacy settings, or full) never breaks the
//   cart. It keeps working in memory for this page view.
// - Changes made in other tabs arrive through the `storage` event. A cart
//   cleared after checkout in one tab is then empty in the others too, instead
//   of a stale tab saving the old lines again on its next change.

/** Where the cart is saved. A change to the stored format needs a new key. */
export const CART_STORAGE_KEY = 'fired-up-pizza.cart.v1';

/** What a line shows, captured when it was added. Prices are estimates (ADR 0003 rule 5). */
export interface CartLineDisplay {
  menuItemName: string;
  sizeName: string;
  crustName: string;
  /** In the same order as the line's `toppingIds`. */
  toppingNames: string[];
  /** The shared pricing formula applied to the catalog rows passed to addItem. */
  unitPriceCents: number;
}

/** One cart line: a pizza configuration and how many of it to order. */
export interface CartLineItem {
  /** Stable while the line exists; use it for updateQuantity, removeItem, and React keys. */
  lineId: string;
  menuItemId: number;
  sizeId: number;
  crustId: number;
  /** Distinct, and at most MAX_TOPPINGS_PER_ITEM of them. */
  toppingIds: number[];
  /** From 1 to MAX_QUANTITY_PER_ITEM. */
  quantity: number;
  display: CartLineDisplay;
}

/** What addItem takes: the catalog rows the customer chose, as the catalog API returned them. */
export interface CartItemInput {
  menuItem: Pick<MenuItem, 'id' | 'name' | 'basePriceCents'>;
  size: Pick<Size, 'id' | 'name' | 'priceMultiplier'>;
  crust: Pick<Crust, 'id' | 'name' | 'priceDeltaCents'>;
  toppings: readonly Pick<Topping, 'id' | 'name' | 'priceCents'>[];
  quantity: number;
}

export interface CartContextValue {
  /** In the order they were added. */
  items: readonly CartLineItem[];
  /** How many pizzas the cart holds: the sum of the lines' quantities. */
  itemCount: number;
  /** The sum of each line's estimated unit price times its quantity; 0 when empty. */
  estimatedTotalCents: number;
  /**
   * Adds a line built from the chosen catalog rows. Its quantity is truncated
   * to a whole number and clamped to 1..MAX_QUANTITY_PER_ITEM, with NaN
   * counting as 1. A topping listed twice counts once, and only the first
   * MAX_TOPPINGS_PER_ITEM toppings are kept, so the unit price always covers
   * exactly the toppings the line holds.
   *
   * When a line with the same item, size, crust, and toppings is already in
   * the cart, the new quantity is added to it, clamped again. That line keeps
   * its place and id, and takes the new snapshot.
   *
   * Throws a RangeError, and leaves the cart unchanged, when an id is not a
   * positive integer or a price is one the pricing formula rejects. That is a
   * bug in the caller, not something a customer can fix.
   */
  addItem: (input: CartItemInput) => void;
  /** Sets a line's quantity, clamped as addItem clamps it. An unknown lineId is ignored. */
  updateQuantity: (lineId: string, quantity: number) => void;
  /** Removes a line. An unknown lineId is ignored. */
  removeItem: (lineId: string) => void;
  /** Empties the cart, e.g. once the order is placed. */
  clear: () => void;
}

/** A line before the cart gives it an id. */
type LineContent = Omit<CartLineItem, 'lineId'>;

type CartAction =
  | { type: 'add'; line: LineContent }
  | { type: 'updateQuantity'; lineId: string; quantity: number }
  | { type: 'remove'; lineId: string }
  | { type: 'clear' }
  | { type: 'replace'; items: CartLineItem[] };

const CartContext = createContext<CartContextValue | null>(null);

/** Holds the cart for everything inside it. AppProviders puts it around the whole app. */
export function CartProvider({ children }: { children: ReactNode }) {
  const [initialStored] = useState(readStoredCart);
  const [items, dispatch] = useReducer(cartReducer, initialStored, parseStoredCart);
  // The value storage holds, as far as this tab knows. The cart is written only
  // when it differs, so restoring a cart or taking another tab's cart does not
  // write it straight back.
  const stored = useRef(initialStored);

  useEffect(() => {
    const serialized = serializeCart(items);
    if (serialized !== stored.current && writeStoredCart(serialized)) {
      stored.current = serialized;
    }
  }, [items]);

  useEffect(() => {
    function takeOtherTabsCart(event: StorageEvent) {
      // A null key means another tab cleared all of this site's storage.
      if (event.key === CART_STORAGE_KEY || event.key === null) {
        stored.current = event.newValue;
        dispatch({ type: 'replace', items: parseStoredCart(event.newValue) });
      }
    }
    window.addEventListener('storage', takeOtherTabsCart);
    return () => window.removeEventListener('storage', takeOtherTabsCart);
  }, []);

  const addItem = useCallback((input: CartItemInput) => {
    dispatch({ type: 'add', line: lineFromInput(input) });
  }, []);
  const updateQuantity = useCallback((lineId: string, quantity: number) => {
    dispatch({ type: 'updateQuantity', lineId, quantity });
  }, []);
  const removeItem = useCallback((lineId: string) => {
    dispatch({ type: 'remove', lineId });
  }, []);
  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      itemCount: items.reduce((count, item) => count + item.quantity, 0),
      estimatedTotalCents: estimateTotalCents(items),
      addItem,
      updateQuantity,
      removeItem,
      clear,
    }),
    [items, addItem, updateQuantity, removeItem, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// useCart lives next to CartProvider, where the pages that use the cart import
// it from. Fast Refresh cannot hot-swap a module that also exports a hook, so in
// development an edit to this file re-runs the modules that import it instead.
// Production builds are unaffected.
// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartContextValue {
  const cart = useContext(CartContext);
  if (cart === null) {
    throw new Error('useCart must be used inside <CartProvider>, which AppProviders provides');
  }
  return cart;
}

function cartReducer(items: CartLineItem[], action: CartAction): CartLineItem[] {
  switch (action.type) {
    case 'add': {
      const { line } = action;
      const match = items.find((item) => sameSelections(item, line));
      if (match === undefined) {
        return [...items, { lineId: nextLineId(items), ...line }];
      }
      const quantity = clampQuantity(match.quantity + line.quantity);
      return items.map((item) =>
        item === match ? { lineId: item.lineId, ...line, quantity } : item,
      );
    }
    case 'updateQuantity': {
      const quantity = clampQuantity(action.quantity);
      const changes = items.some(
        (item) => item.lineId === action.lineId && item.quantity !== quantity,
      );
      return changes
        ? items.map((item) => (item.lineId === action.lineId ? { ...item, quantity } : item))
        : items;
    }
    case 'remove':
      return items.some((item) => item.lineId === action.lineId)
        ? items.filter((item) => item.lineId !== action.lineId)
        : items;
    case 'clear':
      return items.length === 0 ? items : [];
    case 'replace':
      return action.items;
  }
}

/** Builds a line from the chosen rows, enforcing the ordering limits from shared/src/pricing.ts. */
function lineFromInput({ menuItem, size, crust, toppings, quantity }: CartItemInput): LineContent {
  const kept = distinctById(toppings).slice(0, MAX_TOPPINGS_PER_ITEM);
  const line: LineContent = {
    menuItemId: menuItem.id,
    sizeId: size.id,
    crustId: crust.id,
    toppingIds: kept.map((topping) => topping.id),
    quantity: clampQuantity(quantity),
    display: {
      menuItemName: menuItem.name,
      sizeName: size.name,
      crustName: crust.name,
      toppingNames: kept.map((topping) => topping.name),
      unitPriceCents: computeUnitPriceCents({
        basePriceCents: menuItem.basePriceCents,
        sizeMultiplier: size.priceMultiplier,
        crustDeltaCents: crust.priceDeltaCents,
        toppingPricesCents: kept.map((topping) => topping.priceCents),
      }),
    },
  };
  // The same check that storage passes on the way back in, so the cart never
  // saves a line that the next visit would throw away.
  if (parseLineContent(line) === undefined) {
    throw new RangeError(`Not a valid cart line: ${JSON.stringify(line)}`);
  }
  return line;
}

/** A whole number of pizzas from 1 to MAX_QUANTITY_PER_ITEM. NaN counts as 1. */
function clampQuantity(quantity: number): number {
  if (Number.isNaN(quantity)) {
    return 1;
  }
  return Math.min(MAX_QUANTITY_PER_ITEM, Math.max(1, Math.trunc(quantity)));
}

/** The rows with each id's first occurrence only, in their original order. */
function distinctById<Row extends { id: number }>(rows: readonly Row[]): Row[] {
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) {
      return false;
    }
    seen.add(row.id);
    return true;
  });
}

/** Same item, size, crust, and set of toppings, in any order. Topping ids are distinct. */
function sameSelections(a: LineContent, b: LineContent): boolean {
  return (
    a.menuItemId === b.menuItemId &&
    a.sizeId === b.sizeId &&
    a.crustId === b.crustId &&
    a.toppingIds.length === b.toppingIds.length &&
    a.toppingIds.every((toppingId) => b.toppingIds.includes(toppingId))
  );
}

/** The first `line-<n>` id not in use, starting from the number of lines plus one. */
function nextLineId(items: readonly CartLineItem[]): string {
  const taken = new Set(items.map((item) => item.lineId));
  let n = items.length + 1;
  while (taken.has(`line-${n}`)) {
    n += 1;
  }
  return `line-${n}`;
}

/** The shared formula's order total, over the lines' estimated unit prices. */
function estimateTotalCents(items: readonly CartLineItem[]): number {
  return computeOrderTotalCents(
    items.map((item) => ({ unitPriceCents: item.display.unitPriceCents, quantity: item.quantity })),
  );
}

/** An empty cart is stored as no value at all. */
function serializeCart(items: readonly CartLineItem[]): string | null {
  return items.length === 0 ? null : JSON.stringify(items);
}

/**
 * The stored lines, or an empty cart unless every line is valid, every lineId
 * is unique, and the estimated total can be computed.
 */
function parseStoredCart(stored: string | null): CartLineItem[] {
  if (stored === null) {
    return [];
  }
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const lines: unknown[] = value;
  const items = lines.map(parseLine);
  if (!items.every((item) => item !== undefined)) {
    return [];
  }
  const lineIds = new Set(items.map((item) => item.lineId));
  return lineIds.size === items.length && hasSafeTotal(items) ? items : [];
}

/**
 * False when a line total or the order total is past Number.MAX_SAFE_INTEGER,
 * where the pricing functions throw. Such a cart would otherwise fail every
 * render that shows its estimate.
 */
function hasSafeTotal(items: readonly CartLineItem[]): boolean {
  try {
    estimateTotalCents(items);
    return true;
  } catch {
    return false;
  }
}

function parseLine(value: unknown): CartLineItem | undefined {
  if (!isRecord(value) || typeof value.lineId !== 'string' || value.lineId === '') {
    return undefined;
  }
  const content = parseLineContent(value);
  return content === undefined ? undefined : { lineId: value.lineId, ...content };
}

/**
 * A fresh copy of a line's content when it keeps every rule the cart enforces,
 * otherwise undefined. Unknown keys are dropped.
 */
function parseLineContent(value: Record<string, unknown>): LineContent | undefined {
  const { menuItemId, sizeId, crustId, toppingIds, quantity, display } = value;
  if (
    !isId(menuItemId) ||
    !isId(sizeId) ||
    !isId(crustId) ||
    !Array.isArray(toppingIds) ||
    !toppingIds.every(isId) ||
    toppingIds.length > MAX_TOPPINGS_PER_ITEM ||
    new Set(toppingIds).size !== toppingIds.length ||
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_QUANTITY_PER_ITEM ||
    !isRecord(display)
  ) {
    return undefined;
  }
  const { menuItemName, sizeName, crustName, toppingNames, unitPriceCents } = display;
  if (
    typeof menuItemName !== 'string' ||
    typeof sizeName !== 'string' ||
    typeof crustName !== 'string' ||
    !Array.isArray(toppingNames) ||
    !toppingNames.every(isString) ||
    toppingNames.length !== toppingIds.length ||
    typeof unitPriceCents !== 'number' ||
    !Number.isSafeInteger(unitPriceCents) ||
    unitPriceCents < 0
  ) {
    return undefined;
  }
  return {
    menuItemId,
    sizeId,
    crustId,
    toppingIds: [...toppingIds],
    quantity,
    display: {
      menuItemName,
      sizeName,
      crustName,
      toppingNames: [...toppingNames],
      unitPriceCents,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Catalog ids are positive safe integers. */
function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function readStoredCart(): string | null {
  try {
    return window.localStorage.getItem(CART_STORAGE_KEY);
  } catch {
    // Storage is blocked, e.g. by privacy settings: start with an empty cart.
    return null;
  }
}

/** Saves the cart, or removes it when null. False when storage is full or blocked. */
function writeStoredCart(serialized: string | null): boolean {
  try {
    if (serialized === null) {
      window.localStorage.removeItem(CART_STORAGE_KEY);
    } else {
      window.localStorage.setItem(CART_STORAGE_KEY, serialized);
    }
    return true;
  } catch {
    // The cart keeps working in memory for this page view.
    return false;
  }
}
