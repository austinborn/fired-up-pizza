import { describe, expect, it } from 'vitest';
import { isApiErrorBody } from './api-error';

describe('isApiErrorBody', () => {
  it('accepts the ADR 0006 error shape', () => {
    expect(isApiErrorBody({ error: { code: 'NOT_FOUND', message: 'Missing' } })).toBe(true);
    expect(
      isApiErrorBody({
        error: { code: 'VALIDATION_ERROR', message: 'Bad input', details: { issues: [] } },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    'error',
    {},
    { error: null },
    { error: { code: 'NOT_FOUND' } },
    { error: { code: 'TEAPOT', message: 'Unknown code' } },
    { error: { code: 'NOT_FOUND', message: 42 } },
  ])('rejects %j', (value) => {
    expect(isApiErrorBody(value)).toBe(false);
  });
});
