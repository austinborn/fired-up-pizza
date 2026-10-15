import { IN_MEMORY, openDatabase, type Db } from '../db/connection';
import { migrate } from '../db/migrate';
import { seedCatalog } from '../db/seed';

export interface TestDatabaseOptions {
  /** Add the starter catalog (CATALOG_SEED in server/src/db/seed.ts). Off by default. */
  seed?: boolean;
}

/**
 * The database for server tests: in memory (ADR 0002 rule 2) and set up the way
 * server/src/index.ts sets up the real file, with every migration applied and,
 * with `seed: true`, the starter catalog. Each call returns a new, independent
 * database; close it when the test ends.
 */
export function createTestDatabase({ seed = false }: TestDatabaseOptions = {}): Db {
  const db = openDatabase(IN_MEMORY);
  migrate(db);
  if (seed) {
    seedCatalog(db);
  }
  return db;
}
