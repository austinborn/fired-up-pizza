import { describe, expect, it } from 'vitest';
import { formatCents } from './money';

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
