import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from './errors';
import { parseWith } from './validate';

const schema = z.object({
  quantity: z.number().int().min(1),
  notes: z.string().max(5).optional(),
});

describe('parseWith', () => {
  it('returns parsed data and strips unknown keys', () => {
    expect(parseWith(schema, { quantity: 2, unitPriceCents: 1 })).toEqual({ quantity: 2 });
  });

  it('throws a VALIDATION_ERROR listing every issue by path', () => {
    let thrown: unknown;
    try {
      parseWith(schema, { quantity: 0, notes: 'too long' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    const appError = thrown as AppError;
    expect(appError.code).toBe('VALIDATION_ERROR');
    expect(appError.status).toBe(400);
    expect(appError.details).toEqual({
      issues: [
        { path: 'quantity', message: expect.any(String) },
        { path: 'notes', message: expect.any(String) },
      ],
    });
  });
});
