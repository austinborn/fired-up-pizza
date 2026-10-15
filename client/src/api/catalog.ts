import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import { getJson, type RequestOptions } from './http';

// The customer catalog (ADR 0006 rule 2) for the menu and pizza builder pages.
// Each list arrives as the server orders it, and the menu items and toppings
// lists hold available rows only: hidden ones never reach the client. There
// is no endpoint for a single menu item, so a page looks its item up in
// getMenuItems(). An id missing from that list is unknown or hidden.
// Pass the AbortSignal that useAsync provides as `signal`.

/** Available menu items, ordered by category, then name, ignoring case. */
export function getMenuItems(options?: RequestOptions): Promise<MenuItem[]> {
  return getJson<MenuItem[]>('/api/menu-items', options);
}

/** Every size, smallest price multiplier first. */
export function getSizes(options?: RequestOptions): Promise<Size[]> {
  return getJson<Size[]>('/api/sizes', options);
}

/** Every crust, cheapest first, then by name. */
export function getCrusts(options?: RequestOptions): Promise<Crust[]> {
  return getJson<Crust[]>('/api/crusts', options);
}

/** Available toppings, ordered by name, ignoring case. */
export function getToppings(options?: RequestOptions): Promise<Topping[]> {
  return getJson<Topping[]>('/api/toppings', options);
}
