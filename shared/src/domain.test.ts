import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, isOrderStatus } from './domain';

describe('ORDER_STATUSES', () => {
  it('lists the manifest statuses in lifecycle order', () => {
    expect(ORDER_STATUSES).toEqual(['placed', 'preparing', 'ready', 'delivered', 'cancelled']);
  });
});

describe('isOrderStatus', () => {
  it.each(ORDER_STATUSES)('accepts %s', (status) => {
    expect(isOrderStatus(status)).toBe(true);
  });

  it.each(['PLACED', 'shipped', '', null, undefined, 3])('rejects %s', (value) => {
    expect(isOrderStatus(value)).toBe(false);
  });
});
