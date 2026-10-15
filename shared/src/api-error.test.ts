import { describe, expect, it } from 'vitest';
import { apiErrorIssues, isApiErrorBody } from './api-error';

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

describe('apiErrorIssues', () => {
  it('returns the issues listed in details, in order', () => {
    const issues = [
      { path: 'items.0.menuItemId', message: 'Menu item 3 is not available' },
      { path: 'items.1.toppingIds.2', message: 'Topping 7 is not available' },
      { path: '', message: 'Invalid input: expected object, received null' },
    ];

    expect(apiErrorIssues({ issues })).toEqual(issues);
  });

  it('ignores other keys in details', () => {
    const issue = { path: 'notes', message: 'Notes must be at most 500 characters' };

    expect(apiErrorIssues({ issues: [issue], other: 'ignored' })).toEqual([issue]);
  });

  it('leaves out entries that are not issues', () => {
    const issue = { path: 'notes', message: 'Notes must be at most 500 characters' };

    expect(
      apiErrorIssues({
        issues: [
          null,
          'notes',
          { path: 'notes' },
          { message: 'No path' },
          { path: 0, message: 'Numeric path' },
          { path: 'notes', message: ['Not a string'] },
          issue,
        ],
      }),
    ).toEqual([issue]);
  });

  it.each([
    undefined,
    null,
    'issues',
    [],
    {},
    { issues: null },
    { issues: { path: 'notes', message: 'Not a list' } },
  ])('returns no issues for details %j', (details) => {
    expect(apiErrorIssues(details)).toEqual([]);
  });
});
