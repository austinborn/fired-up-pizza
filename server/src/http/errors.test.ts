import { API_ERROR_CODES } from '@fired-up-pizza/shared';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, STATUS_BY_CODE, errorHandler } from './errors';

function appThatThrows(error: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw error;
  });
  app.use(errorHandler);
  return app;
}

describe('AppError', () => {
  it('maps every shared error code to an HTTP status', () => {
    for (const code of API_ERROR_CODES) {
      expect(new AppError(code, 'message').status).toBe(STATUS_BY_CODE[code]);
    }
  });
});

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes AppError with its status, code, message and details', async () => {
    const res = await request(
      appThatThrows(
        new AppError('ILLEGAL_STATUS_TRANSITION', 'Cannot go back', {
          currentStatus: 'ready',
          requestedStatus: 'preparing',
        }),
      ),
    ).get('/boom');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: {
        code: 'ILLEGAL_STATUS_TRANSITION',
        message: 'Cannot go back',
        details: { currentStatus: 'ready', requestedStatus: 'preparing' },
      },
    });
  });

  it('omits details when there are none', async () => {
    const res = await request(appThatThrows(new AppError('NOT_FOUND', 'Missing'))).get('/boom');

    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Missing' } });
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(appThatThrows(new Error('SQLITE_CORRUPT at /secret/path'))).get(
      '/boom',
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
