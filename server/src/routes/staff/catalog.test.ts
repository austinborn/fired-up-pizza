import type { MenuItem, Topping } from '@fired-up-pizza/shared';
import type {
  CreateMenuItemRequest,
  CreateToppingRequest,
} from '@fired-up-pizza/shared/staff-catalog-api';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import type { Db } from '../../db/connection';
import { CATALOG_SEED } from '../../db/seed';
import { createCatalogRepository, type CatalogRepository } from '../../repositories/catalog';
import { createTestDatabase } from '../../test/database';

// The real app on a seeded in-memory database (ADR 0006 rule 7). What customers
// see is read from the customer catalog endpoints, GET /api/menu-items and
// GET /api/toppings, which list available rows only.

const VALIDATION_FAILED = 'Request validation failed';

describe('staff catalog routes', () => {
  let db: Db;
  let app: Express;
  let catalog: CatalogRepository;

  beforeEach(() => {
    db = createTestDatabase({ seed: true });
    app = createApp({ db });
    catalog = createCatalogRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function seededMenuItem(name: string): MenuItem {
    const item = catalog
      .listMenuItems({ includeUnavailable: true })
      .find((candidate) => candidate.name === name);
    if (item === undefined) {
      throw new Error(`No menu item named ${name}`);
    }
    return item;
  }

  function seededTopping(name: string): Topping {
    const topping = catalog
      .listToppings({ includeUnavailable: true })
      .find((candidate) => candidate.name === name);
    if (topping === undefined) {
      throw new Error(`No topping named ${name}`);
    }
    return topping;
  }

  /** The menu items customers see, from the customer catalog. */
  async function customerMenuItems(): Promise<MenuItem[]> {
    const res = await request(app).get('/api/menu-items');
    expect(res.status).toBe(200);
    return res.body;
  }

  /** The toppings customers see, from the customer catalog. */
  async function customerToppings(): Promise<Topping[]> {
    const res = await request(app).get('/api/toppings');
    expect(res.status).toBe(200);
    return res.body;
  }

  describe('menu items', () => {
    const truffle = {
      name: 'Truffle Shuffle',
      description: 'Truffle cream, mushrooms, and fontina.',
      category: 'Specialty',
      basePriceCents: 1799,
    } satisfies CreateMenuItemRequest;

    function allMenuItems(): MenuItem[] {
      return catalog.listMenuItems({ includeUnavailable: true });
    }

    it('lists every item, hidden ones included, by category then name', async () => {
      const hawaiian = seededMenuItem('Hawaiian');
      expect(catalog.updateMenuItem(hawaiian.id, { available: false }).ok).toBe(true);

      const res = await request(app).get('/api/staff/menu-items');

      expect(res.status).toBe(200);
      expect(res.body.map((item: MenuItem) => item.name)).toEqual([
        'Cheese',
        'Margherita',
        'Pepperoni',
        'BBQ Chicken',
        'Fired Up',
        'Hawaiian',
        'Meat Lovers',
        'Garden Veggie',
        'Mediterranean',
      ]);
      expect(res.body).toContainEqual({ ...hawaiian, available: false });
    });

    it('creates an item, available by default, that customers then see', async () => {
      const before = new Date().toISOString();
      const res = await request(app).post('/api/staff/menu-items').send(truffle);
      const after = new Date().toISOString();

      expect(res.status).toBe(201);
      expect(res.body).toStrictEqual({
        ...truffle,
        id: expect.any(Number),
        available: true,
        createdAt: expect.any(String),
      });
      expect(res.body.createdAt >= before && res.body.createdAt <= after).toBe(true);
      expect(await customerMenuItems()).toContainEqual(res.body);
    });

    it('creates a hidden item that only staff see', async () => {
      const res = await request(app)
        .post('/api/staff/menu-items')
        .send({ ...truffle, available: false });

      expect(res.status).toBe(201);
      expect(res.body.available).toBe(false);
      expect((await customerMenuItems()).map((item) => item.id)).not.toContain(res.body.id);
      const staffList = await request(app).get('/api/staff/menu-items');
      expect(staffList.body).toContainEqual(res.body);
    });

    it('trims text fields and ignores fields the server sets', async () => {
      const res = await request(app).post('/api/staff/menu-items').send({
        name: '  Truffle Shuffle\n',
        description: ' Truffle cream. ',
        category: '\tSpecialty ',
        basePriceCents: 1799,
        id: 1,
        createdAt: '2000-01-01T00:00:00.000Z',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Truffle Shuffle',
        description: 'Truffle cream.',
        category: 'Specialty',
      });
      expect(res.body.id).not.toBe(1);
      expect(res.body.createdAt).not.toBe('2000-01-01T00:00:00.000Z');
    });

    it('accepts every field at its limits', async () => {
      const longest = await request(app)
        .post('/api/staff/menu-items')
        .send({
          name: ` ${'n'.repeat(80)} `,
          description: 'd'.repeat(500),
          category: 'c'.repeat(40),
          basePriceCents: 100_000,
        });
      const shortest = await request(app)
        .post('/api/staff/menu-items')
        .send({ name: 'N', description: '', category: 'C', basePriceCents: 0 });

      expect(longest.status).toBe(201);
      expect(longest.body.name).toBe('n'.repeat(80));
      expect(shortest.status).toBe(201);
      expect(shortest.body).toMatchObject({
        name: 'N',
        description: '',
        category: 'C',
        basePriceCents: 0,
      });
    });

    it.each([
      ['no name', { name: undefined }, 'name'],
      ['a blank name', { name: ' \t ' }, 'name'],
      ['an 81-character name', { name: 'n'.repeat(81) }, 'name'],
      ['no description', { description: undefined }, 'description'],
      ['a 501-character description', { description: 'd'.repeat(501) }, 'description'],
      ['a null description', { description: null }, 'description'],
      ['no category', { category: undefined }, 'category'],
      ['a blank category', { category: '  ' }, 'category'],
      ['a 41-character category', { category: 'c'.repeat(41) }, 'category'],
      ['no price', { basePriceCents: undefined }, 'basePriceCents'],
      ['a negative price', { basePriceCents: -1 }, 'basePriceCents'],
      ['a price over 100000 cents', { basePriceCents: 100_001 }, 'basePriceCents'],
      ['a fractional price', { basePriceCents: 1799.5 }, 'basePriceCents'],
      ['a price sent as a string', { basePriceCents: '1799' }, 'basePriceCents'],
      ['a non-boolean available', { available: 'yes' }, 'available'],
    ])('rejects %s with 400 VALIDATION_ERROR and creates nothing', async (_case, change, path) => {
      const res = await request(app)
        .post('/api/staff/menu-items')
        .send({ ...truffle, ...change });

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: VALIDATION_FAILED,
        details: { issues: [{ path, message: expect.any(String) }] },
      });
      expect(allMenuItems()).toHaveLength(CATALOG_SEED.menuItems.length);
    });

    it('rejects a name another item has, ignoring case and outer spaces, with 409', async () => {
      const res = await request(app)
        .post('/api/staff/menu-items')
        .send({ ...truffle, name: ' pepperoni ' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'A menu item with this name already exists',
          details: {
            issues: [{ path: 'name', message: 'A menu item with this name already exists' }],
          },
        },
      });
      expect(allMenuItems()).toHaveLength(CATALOG_SEED.menuItems.length);
    });

    it('keeps the name of a hidden item taken', async () => {
      const hawaiian = seededMenuItem('Hawaiian');
      expect(catalog.updateMenuItem(hawaiian.id, { available: false }).ok).toBe(true);

      const res = await request(app)
        .post('/api/staff/menu-items')
        .send({ ...truffle, name: 'Hawaiian' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('changes only the fields sent and returns the whole item', async () => {
      const margherita = seededMenuItem('Margherita');

      const res = await request(app)
        .patch(`/api/staff/menu-items/${margherita.id}`)
        .send({ description: '', basePriceCents: 1149 });

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({ ...margherita, description: '', basePriceCents: 1149 });
      expect(catalog.getMenuItem(margherita.id)).toStrictEqual(res.body);
    });

    it('changes every field at once, trimmed as on create', async () => {
      const margherita = seededMenuItem('Margherita');

      const res = await request(app).patch(`/api/staff/menu-items/${margherita.id}`).send({
        name: ' Margherita DOP ',
        description: 'Buffalo mozzarella. ',
        category: ' Specialty',
        basePriceCents: 1399,
        available: false,
      });

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({
        ...margherita,
        name: 'Margherita DOP',
        description: 'Buffalo mozzarella.',
        category: 'Specialty',
        basePriceCents: 1399,
        available: false,
      });
    });

    it('hides an item from customers with available: false and shows it again', async () => {
      const pepperoni = seededMenuItem('Pepperoni');
      const path = `/api/staff/menu-items/${pepperoni.id}`;

      const hidden = await request(app).patch(path).send({ available: false });

      expect(hidden.status).toBe(200);
      expect(hidden.body).toStrictEqual({ ...pepperoni, available: false });
      expect((await customerMenuItems()).map((item) => item.id)).not.toContain(pepperoni.id);
      const staffList = await request(app).get('/api/staff/menu-items');
      expect(staffList.body).toContainEqual({ ...pepperoni, available: false });

      const shown = await request(app).patch(path).send({ available: true });

      expect(shown.status).toBe(200);
      expect(shown.body).toStrictEqual(pepperoni);
      expect(await customerMenuItems()).toContainEqual(pepperoni);
    });

    it('treats a body with no known fields as no change', async () => {
      const cheese = seededMenuItem('Cheese');

      const res = await request(app)
        .patch(`/api/staff/menu-items/${cheese.id}`)
        .send({ id: 99, createdAt: '2000-01-01T00:00:00.000Z' });

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual(cheese);
      expect(catalog.getMenuItem(cheese.id)).toStrictEqual(cheese);
    });

    it('validates changes like a create and changes nothing on failure', async () => {
      const cheese = seededMenuItem('Cheese');

      const res = await request(app)
        .patch(`/api/staff/menu-items/${cheese.id}`)
        .send({ name: ' ', category: 'c'.repeat(41), basePriceCents: 10.5, available: null });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.issues.map((issue: { path: string }) => issue.path)).toEqual([
        'name',
        'category',
        'basePriceCents',
        'available',
      ]);
      expect(catalog.getMenuItem(cheese.id)).toStrictEqual(cheese);
    });

    it("rejects another item's name, ignoring case, with 409 and changes nothing", async () => {
      const cheese = seededMenuItem('Cheese');

      const res = await request(app)
        .patch(`/api/staff/menu-items/${cheese.id}`)
        .send({ name: 'MARGHERITA', basePriceCents: 1 });

      expect(res.status).toBe(409);
      expect(res.body.error).toEqual({
        code: 'CONFLICT',
        message: 'A menu item with this name already exists',
        details: {
          issues: [{ path: 'name', message: 'A menu item with this name already exists' }],
        },
      });
      expect(catalog.getMenuItem(cheese.id)).toStrictEqual(cheese);
    });

    it('lets an item change the case of its own name', async () => {
      const cheese = seededMenuItem('Cheese');

      const res = await request(app)
        .patch(`/api/staff/menu-items/${cheese.id}`)
        .send({ name: 'CHEESE' });

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({ ...cheese, name: 'CHEESE' });
    });

    it('answers 404 NOT_FOUND for an unknown id', async () => {
      const res = await request(app).patch('/api/staff/menu-items/9999').send({ available: false });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Menu item not found' } });
    });

    it.each(['abc', '0', '-1', '1.5', '1e3', '0x10', '9007199254740992'])(
      'rejects the id %s with 400 VALIDATION_ERROR',
      async (id) => {
        const res = await request(app)
          .patch(`/api/staff/menu-items/${id}`)
          .send({ available: false });

        expect(res.status).toBe(400);
        expect(res.body.error).toEqual({
          code: 'VALIDATION_ERROR',
          message: VALIDATION_FAILED,
          details: { issues: [{ path: 'id', message: 'Id must be a positive whole number' }] },
        });
      },
    );

    it('has no DELETE endpoint: items are hidden, never deleted', async () => {
      const cheese = seededMenuItem('Cheese');

      const res = await request(app).delete(`/api/staff/menu-items/${cheese.id}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(catalog.getMenuItem(cheese.id)).toStrictEqual(cheese);
    });
  });

  describe('toppings', () => {
    const jalapenos = { name: 'Jalapenos', priceCents: 125 } satisfies CreateToppingRequest;

    function allToppings(): Topping[] {
      return catalog.listToppings({ includeUnavailable: true });
    }

    it('lists every topping, hidden ones included, by name', async () => {
      const pineapple = seededTopping('Pineapple');
      expect(catalog.updateTopping(pineapple.id, { available: false }).ok).toBe(true);

      const res = await request(app).get('/api/staff/toppings');

      expect(res.status).toBe(200);
      expect(res.body.map((topping: Topping) => topping.name)).toEqual([
        'Bacon',
        'Black Olives',
        'Extra Cheese',
        'Fresh Basil',
        'Green Peppers',
        'Grilled Chicken',
        'Ham',
        'Italian Sausage',
        'Mushrooms',
        'Pepperoni',
        'Pineapple',
        'Red Onions',
      ]);
      expect(res.body).toContainEqual({ ...pineapple, available: false });
    });

    it('creates a topping, available by default, that customers then see', async () => {
      const res = await request(app).post('/api/staff/toppings').send(jalapenos);

      expect(res.status).toBe(201);
      expect(res.body).toStrictEqual({ ...jalapenos, id: expect.any(Number), available: true });
      expect(await customerToppings()).toContainEqual(res.body);
    });

    it('creates a hidden topping that only staff see', async () => {
      const res = await request(app)
        .post('/api/staff/toppings')
        .send({ ...jalapenos, available: false });

      expect(res.status).toBe(201);
      expect(res.body.available).toBe(false);
      expect((await customerToppings()).map((topping) => topping.id)).not.toContain(res.body.id);
      const staffList = await request(app).get('/api/staff/toppings');
      expect(staffList.body).toContainEqual(res.body);
    });

    it('trims the name and ignores a client-sent id', async () => {
      const res = await request(app)
        .post('/api/staff/toppings')
        .send({ ...jalapenos, name: ' Jalapenos  ', id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Jalapenos');
      expect(res.body.id).not.toBe(1);
    });

    it('accepts every field at its limits', async () => {
      const longest = await request(app)
        .post('/api/staff/toppings')
        .send({ name: 't'.repeat(80), priceCents: 100_000 });
      const cheapest = await request(app)
        .post('/api/staff/toppings')
        .send({ name: 'T', priceCents: 0 });

      expect(longest.status).toBe(201);
      expect(cheapest.status).toBe(201);
      expect(cheapest.body.priceCents).toBe(0);
    });

    it.each([
      ['no name', { name: undefined }, 'name'],
      ['a blank name', { name: '   ' }, 'name'],
      ['an 81-character name', { name: 't'.repeat(81) }, 'name'],
      ['no price', { priceCents: undefined }, 'priceCents'],
      ['a negative price', { priceCents: -1 }, 'priceCents'],
      ['a price over 100000 cents', { priceCents: 100_001 }, 'priceCents'],
      ['a fractional price', { priceCents: 0.5 }, 'priceCents'],
      ['a price sent as a string', { priceCents: '125' }, 'priceCents'],
      ['a non-boolean available', { available: 1 }, 'available'],
    ])('rejects %s with 400 VALIDATION_ERROR and creates nothing', async (_case, change, path) => {
      const res = await request(app)
        .post('/api/staff/toppings')
        .send({ ...jalapenos, ...change });

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: VALIDATION_FAILED,
        details: { issues: [{ path, message: expect.any(String) }] },
      });
      expect(allToppings()).toHaveLength(CATALOG_SEED.toppings.length);
    });

    it('rejects a name another topping has, ignoring case, with 409', async () => {
      const res = await request(app)
        .post('/api/staff/toppings')
        .send({ ...jalapenos, name: 'MUSHROOMS' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'A topping with this name already exists',
          details: {
            issues: [{ path: 'name', message: 'A topping with this name already exists' }],
          },
        },
      });
      expect(allToppings()).toHaveLength(CATALOG_SEED.toppings.length);
    });

    it('changes only the fields sent and returns the whole topping', async () => {
      const bacon = seededTopping('Bacon');

      const res = await request(app)
        .patch(`/api/staff/toppings/${bacon.id}`)
        .send({ priceCents: 225 });

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual({ ...bacon, priceCents: 225 });
      expect(catalog.getToppingsByIds([bacon.id])).toStrictEqual([res.body]);
    });

    it('hides a topping from customers with available: false and shows it again', async () => {
      const ham = seededTopping('Ham');
      const path = `/api/staff/toppings/${ham.id}`;

      const hidden = await request(app).patch(path).send({ available: false });

      expect(hidden.status).toBe(200);
      expect(hidden.body).toStrictEqual({ ...ham, available: false });
      expect((await customerToppings()).map((topping) => topping.id)).not.toContain(ham.id);
      const staffList = await request(app).get('/api/staff/toppings');
      expect(staffList.body).toContainEqual({ ...ham, available: false });

      const shown = await request(app).patch(path).send({ available: true });

      expect(shown.status).toBe(200);
      expect(shown.body).toStrictEqual(ham);
      expect(await customerToppings()).toContainEqual(ham);
    });

    it('treats a body with no known fields as no change', async () => {
      const ham = seededTopping('Ham');

      const res = await request(app).patch(`/api/staff/toppings/${ham.id}`).send({ id: 99 });

      expect(res.status).toBe(200);
      expect(res.body).toStrictEqual(ham);
    });

    it('validates changes like a create and changes nothing on failure', async () => {
      const ham = seededTopping('Ham');

      const res = await request(app)
        .patch(`/api/staff/toppings/${ham.id}`)
        .send({ name: '', priceCents: -5 });

      expect(res.status).toBe(400);
      expect(res.body.error.details.issues.map((issue: { path: string }) => issue.path)).toEqual([
        'name',
        'priceCents',
      ]);
      expect(catalog.getToppingsByIds([ham.id])).toStrictEqual([ham]);
    });

    it("rejects another topping's name with 409 and changes nothing", async () => {
      const ham = seededTopping('Ham');

      const res = await request(app).patch(`/api/staff/toppings/${ham.id}`).send({ name: 'bacon' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(catalog.getToppingsByIds([ham.id])).toStrictEqual([ham]);
    });

    it('answers 404 NOT_FOUND for an unknown id', async () => {
      const res = await request(app).patch('/api/staff/toppings/9999').send({ priceCents: 1 });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Topping not found' } });
    });

    it('rejects a malformed id with 400 VALIDATION_ERROR', async () => {
      const res = await request(app).patch('/api/staff/toppings/ham').send({ priceCents: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual({
        issues: [{ path: 'id', message: 'Id must be a positive whole number' }],
      });
    });

    it('has no DELETE endpoint: toppings are hidden, never deleted', async () => {
      const ham = seededTopping('Ham');

      const res = await request(app).delete(`/api/staff/toppings/${ham.id}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(catalog.getToppingsByIds([ham.id])).toStrictEqual([ham]);
    });
  });
});
