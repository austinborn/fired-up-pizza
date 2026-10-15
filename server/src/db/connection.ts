import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

export const IN_MEMORY = ':memory:';

/**
 * Opens the single SQLite connection for this process (ADR 0002). File
 * databases get their directory created and WAL journaling; every connection
 * enforces foreign keys. Schema migrations and seeding run on top of this.
 */
export function openDatabase(filename: string): Db {
  if (filename !== IN_MEMORY) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  if (filename !== IN_MEMORY) {
    db.pragma('journal_mode = WAL');
  }
  return db;
}

/**
 * Prepares the round trip behind GET /api/health. The returned check throws
 * once the database stops answering, which the error handler turns into a 500.
 */
export function createDatabasePing(db: Db): () => void {
  const ping = db.prepare('SELECT 1');
  return () => {
    ping.get();
  };
}
