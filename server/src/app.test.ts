import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { IN_MEMORY, openDatabase, type Db } from './db/connection';

describe('createApp', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(IN_MEMORY);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  it('reports health once the database answers', async () => {
    const res = await request(createApp({ db })).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('fails health with a generic 500 once the database stops answering', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({ db });
    db.close();

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' },
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('answers unknown API routes with the ADR 0006 error shape', async () => {
    const res = await request(createApp({ db })).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No route for GET /api/does-not-exist' },
    });
  });

  it('answers unknown staff routes with the same error shape', async () => {
    const res = await request(createApp({ db })).get('/api/staff/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON bodies as VALIDATION_ERROR', async () => {
    const res = await request(createApp({ db }))
      .post('/api/orders')
      .set('Content-Type', 'application/json')
      .send('{"items": [');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON' },
    });
  });

  it('does not advertise Express', async () => {
    const res = await request(createApp({ db })).get('/api/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
