import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError, errorHandler } from '../http/errors';
import { parseWith } from '../http/validate';
import { phoneNumberField, resolveCustomerIdentity } from './index';

/** Returns what resolveCustomerIdentity throws for `rawPhone`, or undefined. */
function errorFor(rawPhone: unknown): unknown {
  try {
    resolveCustomerIdentity(rawPhone);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('resolveCustomerIdentity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['(212) 555-0142', '212.555.0142', '1 212 555 0142', '+12125550142'])(
    'resolves %j to the E.164 phone number',
    (rawPhone) => {
      expect(resolveCustomerIdentity(rawPhone)).toEqual({ phoneNumber: '+12125550142' });
    },
  );

  it.each<[string, unknown]>([
    ['a missing phone', undefined],
    ['null', null],
    ['a number', 2125550142],
    ['an array', ['2125550142']],
    ['an object', { phoneNumber: '2125550142' }],
    ['an empty string', ''],
    ['seven digits', '555-0142'],
    ['an exchange code starting with 1', '555-123-4567'],
    ['another country code', '+44 20 7946 0958'],
  ])('throws a 400 INVALID_PHONE_NUMBER AppError for %s', (_label, rawPhone) => {
    const error = errorFor(rawPhone);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'INVALID_PHONE_NUMBER', status: 400, details: undefined });
  });

  it('never logs the phone number or puts it in the error (ADR 0005 rule 5)', () => {
    const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = consoleMethods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    resolveCustomerIdentity('(212) 555-0142');
    const error = errorFor('212-555-014');

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).message).not.toMatch(/212|555|014/);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('route usage contract', () => {
  // Routes written the way the module header prescribes: zod checks the shape,
  // resolveCustomerIdentity judges the number.
  function appWithPhoneRoutes() {
    const app = express();
    app.use(express.json());
    app.get('/orders', (req, res) => {
      const { phone } = parseWith(z.object({ phone: phoneNumberField.optional() }), req.query);
      res.json(resolveCustomerIdentity(phone));
    });
    app.post('/orders', (req, res) => {
      const body = parseWith(z.object({ phoneNumber: phoneNumberField }), req.body);
      res.json(resolveCustomerIdentity(body.phoneNumber));
    });
    app.use(errorHandler);
    return app;
  }

  const invalidPhoneBody = {
    error: { code: 'INVALID_PHONE_NUMBER', message: expect.any(String) },
  };

  it('resolves differently formatted numbers to the same customer', async () => {
    const app = appWithPhoneRoutes();

    const fromQuery = await request(app).get('/orders').query({ phone: '(212) 555-0142' });
    const fromBody = await request(app).post('/orders').send({ phoneNumber: '+1 212.555.0142' });

    expect(fromQuery.body).toEqual({ phoneNumber: '+12125550142' });
    expect(fromBody.body).toEqual({ phoneNumber: '+12125550142' });
  });

  it('answers an invalid query phone with INVALID_PHONE_NUMBER, not VALIDATION_ERROR', async () => {
    const res = await request(appWithPhoneRoutes()).get('/orders').query({ phone: '555-0142' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidPhoneBody);
    expect(JSON.stringify(res.body)).not.toContain('0142');
  });

  it('answers a missing optional phone with INVALID_PHONE_NUMBER', async () => {
    const res = await request(appWithPhoneRoutes()).get('/orders');

    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidPhoneBody);
  });

  it('answers an invalid body phone with INVALID_PHONE_NUMBER, not VALIDATION_ERROR', async () => {
    const res = await request(appWithPhoneRoutes())
      .post('/orders')
      .send({ phoneNumber: '+44 20 7946 0958' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(invalidPhoneBody);
  });

  it('leaves a phone of the wrong JSON type to request validation', async () => {
    const res = await request(appWithPhoneRoutes())
      .post('/orders')
      .send({ phoneNumber: 2125550142 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('identity boundary', () => {
  it('is the only server module that imports the shared phone parser (ADR 0005 rule 2)', () => {
    const srcDir = fileURLToPath(new URL('..', import.meta.url));
    const importsPhoneParser = /['"]@fired-up-pizza\/shared\/phone['"]/;

    const importers = fs
      .readdirSync(srcDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => importsPhoneParser.test(fs.readFileSync(path.join(srcDir, file), 'utf8')));

    expect(importers).toEqual([path.join('identity', 'index.ts')]);
  });
});
