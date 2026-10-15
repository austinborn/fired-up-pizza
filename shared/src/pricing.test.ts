import { describe, expect, it } from 'vitest';
import {
  computeLineTotalCents,
  computeOrderTotalCents,
  computeUnitPriceCents,
  MAX_QUANTITY_PER_ITEM,
  MAX_TOPPINGS_PER_ITEM,
  type UnitPriceInput,
} from './pricing';

/** A pizza with no crust delta and no toppings. */
function plain(basePriceCents: number, sizeMultiplier: number): UnitPriceInput {
  return { basePriceCents, sizeMultiplier, crustDeltaCents: 0, toppingPricesCents: [] };
}

describe('computeUnitPriceCents', () => {
  it('is the base price for a plain pizza at a 1x size', () => {
    expect(computeUnitPriceCents(plain(999, 1))).toBe(999);
  });

  it.each<[number, number, number, string]>([
    [1099, 1.25, 1374, '1373.75 rounds up'],
    [1549, 1.25, 1936, '1936.25 rounds down'],
    [999, 1.5, 1499, '1498.5 rounds half up'],
    [1, 1.5, 2, '1.5 rounds half up'],
    [0, 1.5, 0, 'a free base stays free'],
  ])('prices a %s-cent base at a %s multiplier as %s cents (%s)', (base, multiplier, expected) => {
    expect(computeUnitPriceCents(plain(base, multiplier))).toBe(expected);
  });

  it('adds the crust delta and every topping price to the rounded base', () => {
    expect(
      computeUnitPriceCents({
        basePriceCents: 1099,
        sizeMultiplier: 1.25,
        crustDeltaCents: 200,
        toppingPricesCents: [200, 150],
      }),
    ).toBe(1374 + 200 + 200 + 150);
  });

  it('applies the size multiplier to the base price only', () => {
    // Scaling the crust and toppings too would give (1000 + 300 + 350) * 1.5 = 2475.
    expect(
      computeUnitPriceCents({
        basePriceCents: 1000,
        sizeMultiplier: 1.5,
        crustDeltaCents: 300,
        toppingPricesCents: [100, 250],
      }),
    ).toBe(2150);
  });

  it('returns the whole number of cents nearest the exact formula for any multiplier', () => {
    for (const basePriceCents of [1, 7, 999, 1099, 1349, 1549]) {
      for (const sizeMultiplier of [0.85, 1.1, 1.15, 1.3, 4 / 3, 1.75]) {
        const unitPriceCents = computeUnitPriceCents({
          basePriceCents,
          sizeMultiplier,
          crustDeltaCents: 125,
          toppingPricesCents: [150, 250],
        });

        expect(Number.isSafeInteger(unitPriceCents)).toBe(true);
        expect(
          Math.abs(unitPriceCents - (basePriceCents * sizeMultiplier + 525)),
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it.each<[string, Partial<UnitPriceInput>]>([
    ['a base price in dollars', { basePriceCents: 10.99 }],
    ['a negative base price', { basePriceCents: -1 }],
    ['a NaN base price', { basePriceCents: Number.NaN }],
    ['a missing base price', { basePriceCents: undefined }],
    ['a zero size multiplier', { sizeMultiplier: 0 }],
    ['a negative size multiplier', { sizeMultiplier: -1.25 }],
    ['a NaN size multiplier', { sizeMultiplier: Number.NaN }],
    ['an infinite size multiplier', { sizeMultiplier: Number.POSITIVE_INFINITY }],
    ['a fractional crust delta', { crustDeltaCents: 1.5 }],
    ['a negative crust delta', { crustDeltaCents: -200 }],
    ['a fractional topping price', { toppingPricesCents: [200, 1.5] }],
    ['a negative topping price', { toppingPricesCents: [-150] }],
    ['a price too large to add exactly', { basePriceCents: Number.MAX_SAFE_INTEGER }],
  ])('throws a RangeError for %s', (_label, overrides) => {
    expect(() => computeUnitPriceCents({ ...plain(1099, 1.25), ...overrides })).toThrow(RangeError);
  });
});

describe('computeLineTotalCents', () => {
  it('multiplies the unit price by the quantity', () => {
    expect(computeLineTotalCents(1924, 3)).toBe(5772);
    expect(computeLineTotalCents(1374, 1)).toBe(1374);
  });

  it.each<[string, number, number]>([
    ['a fractional quantity', 1924, 1.5],
    ['a negative quantity', 1924, -1],
    ['a unit price in dollars', 19.24, 2],
    ['a NaN unit price', Number.NaN, 1],
    ['a total too large to multiply exactly', Number.MAX_SAFE_INTEGER, 2],
  ])('throws a RangeError for %s', (_label, unitPriceCents, quantity) => {
    expect(() => computeLineTotalCents(unitPriceCents, quantity)).toThrow(RangeError);
  });
});

describe('computeOrderTotalCents', () => {
  it('sums the line totals', () => {
    expect(
      computeOrderTotalCents([
        { unitPriceCents: 1924, quantity: 2 },
        { unitPriceCents: 999, quantity: 1 },
        { unitPriceCents: 1499, quantity: 3 },
      ]),
    ).toBe(3848 + 999 + 4497);
  });

  it('is 0 for an order with no lines', () => {
    expect(computeOrderTotalCents([])).toBe(0);
  });

  it('throws a RangeError for a line that is not whole cents', () => {
    expect(() =>
      computeOrderTotalCents([
        { unitPriceCents: 1924, quantity: 1 },
        { unitPriceCents: 10.99, quantity: 1 },
      ]),
    ).toThrow(RangeError);
  });

  it('throws a RangeError for a total too large to add exactly', () => {
    const half = 2 ** 52; // Each line is safe; their sum, 2 ** 53, is not.
    expect(() =>
      computeOrderTotalCents([
        { unitPriceCents: half, quantity: 1 },
        { unitPriceCents: half, quantity: 1 },
      ]),
    ).toThrow(RangeError);
  });
});

describe('ordering limits', () => {
  it('allow 20 of one pizza per order line and 10 toppings per pizza', () => {
    expect(MAX_QUANTITY_PER_ITEM).toBe(20);
    expect(MAX_TOPPINGS_PER_ITEM).toBe(10);
  });
});
