// The pricing formula (ADR 0003 rule 2), implemented once. The client uses it
// for estimates in the builder and cart. server/src/services/pricing.ts uses it
// for the prices an order stores. Both run the same function on the same
// catalog values, so an estimate matches the final total whenever the catalog
// has not changed in between. Once an order is placed, the client shows the
// server's totals, not its own estimate (ADR 0003 rule 5).
//
// Money is integer cents (ADR 0003 rule 1). Only the size multiplier is
// fractional. It scales the base price alone, and that product is rounded once,
// half up, before the crust and toppings are added. Every function returns a
// non-negative safe integer or throws a RangeError. An amount that is not whole
// cents (dollars passed by mistake, NaN, a missing amount) is a bug, not a price.

/** The most pizzas one order line can hold, all with the same size, crust, and toppings. */
export const MAX_QUANTITY_PER_ITEM = 20;

/** The most toppings one pizza can have. */
export const MAX_TOPPINGS_PER_ITEM = 10;

/** The catalog values that price one pizza. */
export interface UnitPriceInput {
  /** The menu item's `basePriceCents`. */
  basePriceCents: number;
  /** The size's `priceMultiplier`. */
  sizeMultiplier: number;
  /** The crust's `priceDeltaCents`. */
  crustDeltaCents: number;
  /** The `priceCents` of each chosen topping. */
  toppingPricesCents: readonly number[];
}

/** The part of an order line that its total depends on. */
export interface PricedLine {
  unitPriceCents: number;
  quantity: number;
}

/**
 * The price of one pizza: `Math.round(basePriceCents * sizeMultiplier) +
 * crustDeltaCents + sum(toppingPricesCents)`. For example, a 1099-cent pizza at
 * a 1.25 size multiplier comes to 1374 cents (1373.75 rounded) before its crust
 * and toppings.
 */
export function computeUnitPriceCents({
  basePriceCents,
  sizeMultiplier,
  crustDeltaCents,
  toppingPricesCents,
}: UnitPriceInput): number {
  requireWholeNumber('basePriceCents', basePriceCents);
  if (!Number.isFinite(sizeMultiplier) || sizeMultiplier <= 0) {
    throw new RangeError(`sizeMultiplier must be a positive finite number, got ${sizeMultiplier}`);
  }
  requireWholeNumber('crustDeltaCents', crustDeltaCents);
  const toppingsCents = toppingPricesCents.reduce(
    (sum, priceCents, index) =>
      sum + requireWholeNumber(`toppingPricesCents[${index}]`, priceCents),
    0,
  );
  return requireWholeNumber(
    'unitPriceCents',
    Math.round(basePriceCents * sizeMultiplier) + crustDeltaCents + toppingsCents,
  );
}

/** The total of one order line: `unitPriceCents * quantity`. */
export function computeLineTotalCents(unitPriceCents: number, quantity: number): number {
  requireWholeNumber('unitPriceCents', unitPriceCents);
  requireWholeNumber('quantity', quantity);
  return requireWholeNumber('lineTotalCents', unitPriceCents * quantity);
}

/** The total of an order: the sum of its line totals, 0 for no lines. */
export function computeOrderTotalCents(lines: readonly PricedLine[]): number {
  const totalCents = lines.reduce(
    (sum, { unitPriceCents, quantity }) => sum + computeLineTotalCents(unitPriceCents, quantity),
    0,
  );
  return requireWholeNumber('totalCents', totalCents);
}

/**
 * Returns `value` when it is a non-negative safe integer, the range in which
 * sums and products of cents stay exact. Throws a RangeError otherwise.
 */
function requireWholeNumber(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${value}`);
  }
  return value;
}
