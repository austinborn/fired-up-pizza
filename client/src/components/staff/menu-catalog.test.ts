import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import {
  changedValues,
  checkCategory,
  checkDescription,
  checkName,
  checkPrice,
  isNameConflict,
  parseMenuItemDraft,
  parseToppingDraft,
} from './menu-catalog';

// The limits are the server's (shared/src/staff-catalog-api.ts): names 1-80
// characters, categories 1-40, descriptions 0-500, all after trimming, and
// prices 0-100000 cents.

describe('checkName', () => {
  it('trims the name', () => {
    expect(checkName('  Truffle Shuffle\n')).toEqual({ ok: true, value: 'Truffle Shuffle' });
  });

  it.each([
    ['80 characters', 'n'.repeat(80)],
    ['80 characters inside spaces', ` ${'n'.repeat(80)} `],
    ['one character', 'N'],
  ])('accepts %s', (_case, text) => {
    expect(checkName(text)).toMatchObject({ ok: true });
  });

  it.each([
    ['an empty name', '', 'Name is required'],
    ['a blank name', ' \t ', 'Name is required'],
    ['81 characters', 'n'.repeat(81), 'Name must be at most 80 characters'],
  ])('rejects %s', (_case, text, error) => {
    expect(checkName(text)).toEqual({ ok: false, error });
  });
});

describe('checkCategory', () => {
  it.each([
    ['a category', ' Specialty ', { ok: true, value: 'Specialty' }],
    ['40 characters', 'c'.repeat(40), { ok: true, value: 'c'.repeat(40) }],
    ['a blank category', '  ', { ok: false, error: 'Category is required' }],
    [
      '41 characters',
      'c'.repeat(41),
      { ok: false, error: 'Category must be at most 40 characters' },
    ],
  ])('checks %s', (_case, text, result) => {
    expect(checkCategory(text)).toEqual(result);
  });
});

describe('checkDescription', () => {
  it.each([
    ['an empty description', '', { ok: true, value: '' }],
    ['a blank description, as empty', '  \n ', { ok: true, value: '' }],
    ['500 characters', 'd'.repeat(500), { ok: true, value: 'd'.repeat(500) }],
    [
      '501 characters',
      'd'.repeat(501),
      { ok: false, error: 'Description must be at most 500 characters' },
    ],
  ])('checks %s', (_case, text, result) => {
    expect(checkDescription(text)).toEqual(result);
  });
});

describe('checkPrice', () => {
  it.each([
    ['10', 1000],
    ['10.5', 1050],
    ['10.05', 1005],
    ['0', 0],
    ['1000', 100_000],
    ['1000.00', 100_000],
  ])('reads %j as %i cents', (text, cents) => {
    expect(checkPrice(text)).toEqual({ ok: true, value: cents });
  });

  it.each([
    ['an empty price', '', 'Price is required'],
    ['a blank price', '   ', 'Price is required'],
    ['words', 'ten', 'Enter a price in dollars and cents, like 12.99'],
    ['a negative price', '-1', 'Enter a price in dollars and cents, like 12.99'],
    ['fractions of a cent', '10.999', 'Enter a price in dollars and cents, like 12.99'],
    ['a price over $1,000.00', '1000.01', 'Price must be at most $1,000.00'],
  ])('rejects %s', (_case, text, error) => {
    expect(checkPrice(text)).toEqual({ ok: false, error });
  });
});

describe('parseMenuItemDraft', () => {
  it('turns a valid draft into the request values', () => {
    expect(
      parseMenuItemDraft({
        name: ' Truffle Shuffle ',
        description: 'Truffle cream, mushrooms, and fontina. ',
        category: 'Specialty',
        basePriceCents: '17.99',
      }),
    ).toEqual({
      ok: true,
      values: {
        name: 'Truffle Shuffle',
        description: 'Truffle cream, mushrooms, and fontina.',
        category: 'Specialty',
        basePriceCents: 1799,
      },
    });
  });

  it('reports every field that is wrong', () => {
    expect(
      parseMenuItemDraft({
        name: '',
        description: 'd'.repeat(501),
        category: 'Specialty',
        basePriceCents: 'free',
      }),
    ).toEqual({
      ok: false,
      errors: {
        name: 'Name is required',
        description: 'Description must be at most 500 characters',
        basePriceCents: 'Enter a price in dollars and cents, like 12.99',
      },
    });
  });
});

describe('parseToppingDraft', () => {
  it('turns a valid draft into the request values', () => {
    expect(parseToppingDraft({ name: 'Jalapenos', priceCents: '1.25' })).toEqual({
      ok: true,
      values: { name: 'Jalapenos', priceCents: 125 },
    });
  });

  it('reports every field that is wrong', () => {
    expect(parseToppingDraft({ name: ' ', priceCents: '1,25' })).toEqual({
      ok: false,
      errors: {
        name: 'Name is required',
        priceCents: 'Enter a price in dollars and cents, like 12.99',
      },
    });
  });
});

describe('changedValues', () => {
  const before = { name: 'Margherita', category: 'Classic', basePriceCents: 1099 };

  it('keeps only the fields that differ', () => {
    expect(changedValues(before, { ...before, basePriceCents: 1149 })).toEqual({
      basePriceCents: 1149,
    });
  });

  it('counts a change of letter case as a change', () => {
    expect(changedValues(before, { ...before, name: 'MARGHERITA' })).toEqual({
      name: 'MARGHERITA',
    });
  });

  it('is empty when nothing changed', () => {
    expect(changedValues(before, { ...before })).toEqual({});
  });
});

describe('isNameConflict', () => {
  it('is true for a CONFLICT', () => {
    expect(isNameConflict(new ApiError(409, 'CONFLICT', 'Name taken'))).toBe(true);
  });

  it.each([
    { name: 'a NOT_FOUND', error: new ApiError(404, 'NOT_FOUND', 'Menu item not found') },
    {
      name: 'a VALIDATION_ERROR',
      error: new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed'),
    },
    { name: 'a network failure', error: new ApiError(0, 'NETWORK_ERROR', "Can't reach it") },
    { name: 'an error that is not an ApiError', error: new Error('CONFLICT') },
  ])('is false for $name', ({ error }) => {
    expect(isNameConflict(error)).toBe(false);
  });
});
