import { MAX_CATALOG_PRICE_CENTS } from '@fired-up-pizza/shared/staff-catalog-api';
import { describe, expect, it } from 'vitest';
import { formatCents, formatCentsForInput, parseDollarsToCents } from './money';

describe('formatCents', () => {
  it.each([
    [1374, '$13.74'],
    [0, '$0.00'],
    [5, '$0.05'],
    [1200, '$12.00'],
    [123456, '$1,234.56'],
    [-500, '-$5.00'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });
});

describe('formatCentsForInput', () => {
  it.each([
    [1299, '12.99'],
    [1000, '10.00'],
    [1050, '10.50'],
    [1005, '10.05'],
    [5, '0.05'],
    [0, '0.00'],
    [100_000, '1000.00'],
    [-150, '-1.50'],
  ])('formats %i cents as %s', (cents, text) => {
    expect(formatCentsForInput(cents)).toBe(text);
  });
});

describe('parseDollarsToCents', () => {
  it.each([
    ['10', 1000],
    ['10.5', 1050],
    ['10.05', 1005],
    ['10.50', 1050],
    ['12.99', 1299],
    ['0', 0],
    ['0.00', 0],
    ['0.01', 1],
    ['.5', 50],
    ['.05', 5],
    ['10.', 1000],
    ['007.10', 710],
    ['1000', 100_000],
    ['$12.99', 1299],
    ['$ 12.99', 1299],
    ['  12.99\t', 1299],
  ])('reads %j as %i cents', (text, cents) => {
    expect(parseDollarsToCents(text)).toBe(cents);
  });

  // Each of these is off by one cent when computed as Math.trunc(parseFloat(text) * 100).
  it.each([
    ['0.29', 29],
    ['1.15', 115],
    ['4.35', 435],
    ['8.12', 812],
    ['19.99', 1999],
  ])('reads %j as exactly %i cents, where float math would not', (text, cents) => {
    expect(Math.trunc(parseFloat(text) * 100)).not.toBe(cents);
    expect(parseDollarsToCents(text)).toBe(cents);
  });

  it.each([
    ['an empty string', ''],
    ['spaces', '   '],
    ['a lone decimal point', '.'],
    ['a lone dollar sign', '$'],
    ['words', 'twelve'],
    ['a negative amount', '-1'],
    ['a negative amount after the dollar sign', '$-1'],
    ['a plus sign', '+1'],
    ['three decimal places', '10.999'],
    ['a trailing zero past the cents', '10.500'],
    ['a thousands separator', '1,000'],
    ['a decimal comma', '10,50'],
    ['two decimal points', '10.5.5'],
    ['an exponent', '1e3'],
    ['hexadecimal', '0x10'],
    ['Infinity', 'Infinity'],
    ['NaN', 'NaN'],
    ['a space inside the amount', '12 .99'],
    ['a dollar sign after the amount', '12.99$'],
    ['a currency code', '12.99 USD'],
    ['full-width digits', '１２'],
    ['an amount too large to count in cents exactly', '90071992547409.92'],
    ['a huge amount', '99999999999999999999'],
  ])('rejects %s', (_case, text) => {
    expect(parseDollarsToCents(text)).toBeNull();
  });

  it('still counts the largest amount that is exact in cents', () => {
    expect(parseDollarsToCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('reads back every catalog price that formatCentsForInput writes', () => {
    for (let cents = 0; cents <= MAX_CATALOG_PRICE_CENTS; cents += 1) {
      const text = formatCentsForInput(cents);
      if (parseDollarsToCents(text) !== cents) {
        expect.fail(
          `${cents} cents was written as "${text}" and read back as ${parseDollarsToCents(text)}`,
        );
      }
    }
  });
});
