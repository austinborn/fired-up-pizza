import type { Db } from './db/connection';

/**
 * Everything a router needs, passed in by createApp so tests can supply an
 * in-memory database (ADR 0006 rule 7).
 */
export interface AppDependencies {
  db: Db;
}
