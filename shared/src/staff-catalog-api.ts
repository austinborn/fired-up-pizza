// Staff menu management API (ADR 0006): request types and field limits shared
// by server/src/routes/staff/catalog.ts and the staff menu page.
//
//   GET   /api/staff/menu-items       -> MenuItem[], hidden items included
//   POST  /api/staff/menu-items       CreateMenuItemRequest -> 201 MenuItem
//   PATCH /api/staff/menu-items/:id   UpdateMenuItemRequest -> MenuItem
//   GET   /api/staff/toppings         -> Topping[], hidden toppings included
//   POST  /api/staff/toppings         CreateToppingRequest -> 201 Topping
//   PATCH /api/staff/toppings/:id     UpdateToppingRequest -> Topping
//
// Nothing is ever deleted. Hiding is a PATCH with `available: false`, so past
// orders keep their references (ADR 0002 rule 7) and their snapshot prices
// (ADR 0003 rule 4).
//
// Errors use the ADR 0006 shape:
// - 400 VALIDATION_ERROR when a field breaks the limits below. The server trims
//   names, descriptions, and categories first, and lengths are JavaScript
//   string lengths, so a form can run the same checks before sending.
// - 404 NOT_FOUND for an unknown id.
// - 409 CONFLICT when another menu item (or another topping) already has the
//   name, ignoring letter case. That is the schema's NOCASE collation, which
//   folds ASCII letters only: names that differ just in the case of an accented
//   letter do not clash. The conflict's `details.issues` has the validation
//   error's shape, `[{ path: 'name', message }]`, so a form shows both kinds of
//   error the same way, next to the field.

import type { MenuItem, Topping } from './domain';

/** Longest menu item or topping name, after trimming. Names need at least one character. */
export const MAX_CATALOG_NAME_LENGTH = 80;

/** Longest menu item description, after trimming. A description may be empty. */
export const MAX_MENU_ITEM_DESCRIPTION_LENGTH = 500;

/** Longest menu item category, after trimming. Categories need at least one character. */
export const MAX_MENU_ITEM_CATEGORY_LENGTH = 40;

/** Highest menu item base price or topping price: $1,000.00. Prices are whole cents from 0 (ADR 0003). */
export const MAX_CATALOG_PRICE_CENTS = 100_000;

/** POST /api/staff/menu-items. `available` defaults to true; the server sets `id` and `createdAt`. */
export type CreateMenuItemRequest = Pick<
  MenuItem,
  'name' | 'description' | 'category' | 'basePriceCents'
> &
  Partial<Pick<MenuItem, 'available'>>;

/** PATCH /api/staff/menu-items/:id. Any subset of the fields; omitted ones keep their values. */
export type UpdateMenuItemRequest = Partial<
  Pick<MenuItem, 'name' | 'description' | 'category' | 'basePriceCents' | 'available'>
>;

/** POST /api/staff/toppings. `available` defaults to true; the server sets `id`. */
export type CreateToppingRequest = Pick<Topping, 'name' | 'priceCents'> &
  Partial<Pick<Topping, 'available'>>;

/** PATCH /api/staff/toppings/:id. Any subset of the fields; omitted ones keep their values. */
export type UpdateToppingRequest = Partial<Pick<Topping, 'name' | 'priceCents' | 'available'>>;
