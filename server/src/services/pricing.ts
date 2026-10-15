// Server-side order pricing (ADR 0003 rules 2 and 3). An order request names
// catalog rows by id. This service loads the current rows, rejects anything that
// cannot be ordered, and prices every item with the shared formula. The prices
// an order stores therefore never come from the client: the input type has no
// price fields, and every price in the output is read from a catalog row.
//
// Errors carry the issue list that parseWith gives zod failures (ADR 0006
// rule 4), `details.issues: [{ path, message }]`. Paths point into the
// place-order request body, e.g. `items.0.toppingIds.2`, and each error lists
// every problem of its kind in the request, not just the first:
//   - 400 VALIDATION_ERROR: a quantity outside 1..MAX_QUANTITY_PER_ITEM, more
//     than MAX_TOPPINGS_PER_ITEM toppings, or a topping listed twice. These are
//     checked before any catalog lookup.
//   - 422 ITEM_UNAVAILABLE: a menu item or topping that does not exist or is
//     hidden, or a size or crust that does not exist.

import {
  computeOrderTotalCents,
  computeUnitPriceCents,
  MAX_QUANTITY_PER_ITEM,
  MAX_TOPPINGS_PER_ITEM,
} from '@fired-up-pizza/shared/pricing';
import type { Db } from '../db/connection';
import { AppError } from '../http/errors';
import type { ValidationIssue } from '../http/validate';
import { createCatalogRepository, type CatalogRepository } from '../repositories/catalog';

/** One requested item: catalog ids and a quantity, never a price (ADR 0003 rule 3). */
export interface OrderItemSelection {
  menuItemId: number;
  sizeId: number;
  crustId: number;
  toppingIds: readonly number[];
  quantity: number;
}

/** A topping's current price, to snapshot into `order_item_toppings.price_cents`. */
export interface PricedTopping {
  toppingId: number;
  priceCents: number;
}

/** An item priced from current catalog rows, to snapshot into `order_items` (ADR 0003 rule 4). */
export interface PricedOrderItem {
  menuItemId: number;
  sizeId: number;
  crustId: number;
  quantity: number;
  unitPriceCents: number;
  /** In the order the request listed them. */
  toppings: PricedTopping[];
}

export interface PricedOrder {
  /** In the order the request listed them. */
  items: PricedOrderItem[];
  /** The sum of each item's unit price times its quantity, for `orders.total_cents`. */
  totalCents: number;
}

/**
 * Prices the requested items from the current catalog rows, or throws AppError
 * VALIDATION_ERROR or ITEM_UNAVAILABLE as described at the top of this file. It
 * only reads, so it can run inside the place-order transaction, which then
 * prices and inserts against the same catalog.
 */
export function priceOrderItems(db: Db, items: readonly OrderItemSelection[]): PricedOrder {
  const invalid = items.flatMap((item, index) => limitIssues(item, `items.${index}`));
  if (invalid.length > 0) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', { issues: invalid });
  }

  const catalog = catalogFor(db);
  const unavailable: ValidationIssue[] = [];
  const pricedItems = items.map((item, index) =>
    priceItem(catalog, item, `items.${index}`, unavailable),
  );
  if (!pricedItems.every((pricedItem) => pricedItem !== undefined)) {
    throw new AppError('ITEM_UNAVAILABLE', 'Some of the items in this order are not available', {
      issues: unavailable,
    });
  }
  return { items: pricedItems, totalCents: computeOrderTotalCents(pricedItems) };
}

/** Checks the ordering limits from shared/src/pricing.ts, which need no catalog lookup. */
function limitIssues(item: OrderItemSelection, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (
    !Number.isInteger(item.quantity) ||
    item.quantity < 1 ||
    item.quantity > MAX_QUANTITY_PER_ITEM
  ) {
    issues.push({
      path: `${path}.quantity`,
      message: `Quantity must be a whole number from 1 to ${MAX_QUANTITY_PER_ITEM}`,
    });
  }
  if (item.toppingIds.length > MAX_TOPPINGS_PER_ITEM) {
    issues.push({
      path: `${path}.toppingIds`,
      message: `A pizza can have at most ${MAX_TOPPINGS_PER_ITEM} toppings`,
    });
  }
  if (new Set(item.toppingIds).size < item.toppingIds.length) {
    issues.push({ path: `${path}.toppingIds`, message: 'Each topping can be added only once' });
  }
  return issues;
}

/**
 * Prices one item from the current catalog rows. Each row that cannot be
 * ordered adds an issue to `unavailable`, and the item then prices as undefined.
 */
function priceItem(
  catalog: CatalogRepository,
  item: OrderItemSelection,
  path: string,
  unavailable: ValidationIssue[],
): PricedOrderItem | undefined {
  const reportUnavailable = (field: string, message: string): undefined => {
    unavailable.push({ path: `${path}.${field}`, message });
    return undefined;
  };
  const menuItem =
    orderable(catalog.getMenuItem(item.menuItemId)) ??
    reportUnavailable('menuItemId', `Menu item ${item.menuItemId} is not available`);
  const size =
    catalog.getSize(item.sizeId) ??
    reportUnavailable('sizeId', `Size ${item.sizeId} is not available`);
  const crust =
    catalog.getCrust(item.crustId) ??
    reportUnavailable('crustId', `Crust ${item.crustId} is not available`);
  const toppingsById = new Map(
    catalog.getToppingsByIds(item.toppingIds).map((topping) => [topping.id, topping]),
  );
  const toppings = item.toppingIds.map(
    (toppingId, index) =>
      orderable(toppingsById.get(toppingId)) ??
      reportUnavailable(`toppingIds.${index}`, `Topping ${toppingId} is not available`),
  );
  if (
    menuItem === undefined ||
    size === undefined ||
    crust === undefined ||
    !toppings.every((topping) => topping !== undefined)
  ) {
    return undefined;
  }

  return {
    menuItemId: menuItem.id,
    sizeId: size.id,
    crustId: crust.id,
    quantity: item.quantity,
    unitPriceCents: computeUnitPriceCents({
      basePriceCents: menuItem.basePriceCents,
      sizeMultiplier: size.priceMultiplier,
      crustDeltaCents: crust.priceDeltaCents,
      toppingPricesCents: toppings.map((topping) => topping.priceCents),
    }),
    toppings: toppings.map((topping) => ({
      toppingId: topping.id,
      priceCents: topping.priceCents,
    })),
  };
}

/** Hidden menu items and toppings stay in the catalog for existing orders but cannot be ordered. */
function orderable<Row extends { available: boolean }>(row: Row | undefined): Row | undefined {
  return row?.available === true ? row : undefined;
}

/**
 * createCatalogRepository prepares its statements each time it runs, so keep one
 * repository per connection instead of one per order. A WeakMap lets a closed
 * test database be garbage-collected along with its statements.
 */
const catalogs = new WeakMap<Db, CatalogRepository>();

function catalogFor(db: Db): CatalogRepository {
  let catalog = catalogs.get(db);
  if (catalog === undefined) {
    catalog = createCatalogRepository(db);
    catalogs.set(db, catalog);
  }
  return catalog;
}
