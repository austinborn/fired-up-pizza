import { afterEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { CATALOG_SEED, seedCatalog } from '../db/seed';
import { createCatalogRepository } from '../repositories/catalog';
import { createTestDatabase, type TestDatabaseOptions } from './database';

describe('createTestDatabase', () => {
  const opened: Db[] = [];

  function open(options?: TestDatabaseOptions): Db {
    const db = createTestDatabase(options);
    opened.push(db);
    return db;
  }

  afterEach(() => {
    for (const db of opened.splice(0)) {
      db.close();
    }
  });

  it('returns an in-memory database with every migration applied', () => {
    const db = open();

    expect(db.memory).toBe(true);
    expect(migrate(db)).toEqual([]);
  });

  it('leaves the catalog empty by default', () => {
    const catalog = createCatalogRepository(open());

    expect(catalog.listMenuItems({ includeUnavailable: true })).toEqual([]);
    expect(catalog.listSizes()).toEqual([]);
    expect(catalog.listCrusts()).toEqual([]);
    expect(catalog.listToppings({ includeUnavailable: true })).toEqual([]);
  });

  it('adds the starter catalog with seed: true', () => {
    const catalog = createCatalogRepository(open({ seed: true }));

    expect(catalog.listSizes().map((size) => size.name)).toEqual(['Small', 'Medium', 'Large']);
    expect(catalog.listCrusts()).toHaveLength(CATALOG_SEED.crusts.length);
    expect(catalog.listToppings()).toHaveLength(CATALOG_SEED.toppings.length);
    expect(catalog.listMenuItems()).toHaveLength(CATALOG_SEED.menuItems.length);
  });

  it('returns a new database on every call', () => {
    const first = open();
    const second = open();
    seedCatalog(first);

    expect(createCatalogRepository(first).listSizes()).toHaveLength(3);
    expect(createCatalogRepository(second).listSizes()).toEqual([]);
  });
});
