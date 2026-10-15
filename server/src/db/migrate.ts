import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection';

/** The numbered SQL files, found relative to this module (ADR 0002 rule 3). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('migrations', import.meta.url));

/** NNNN_description.sql, where NNNN is the version recorded in schema_migrations. */
const MIGRATION_FILE_NAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  version: number;
  /** File name, e.g. `0001_initial.sql`. */
  name: string;
  sql: string;
}

/**
 * Puts migration files in filename order, the order they apply in. Files that
 * are not `.sql`, such as tests kept next to the migrations, are ignored. A
 * misnamed `.sql` file or two files sharing a version is an error, not a
 * migration that silently never runs.
 */
export function orderMigrationFiles(
  fileNames: readonly string[],
): Pick<Migration, 'version' | 'name'>[] {
  const nameByVersion = new Map<number, string>();
  return fileNames
    .filter((name) => name.endsWith('.sql'))
    .toSorted()
    .map((name) => {
      const digits = MIGRATION_FILE_NAME.exec(name)?.[1];
      if (digits === undefined) {
        throw new Error(`Migration file ${name} must be named NNNN_description.sql`);
      }
      const version = Number(digits);
      const sameVersion = nameByVersion.get(version);
      if (sameVersion !== undefined) {
        throw new Error(`Migrations ${sameVersion} and ${name} share version ${digits}`);
      }
      nameByVersion.set(version, name);
      return { version, name };
    });
}

/** Reads every migration in `directory`, in the order they apply. */
export function loadMigrations(directory: string = MIGRATIONS_DIR): Migration[] {
  const fileNames = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  return orderMigrationFiles(fileNames).map((file) => ({
    ...file,
    sql: fs.readFileSync(path.join(directory, file.name), 'utf8'),
  }));
}

/**
 * Brings the schema up to date (ADR 0002 rule 3). Each pending migration runs in
 * its own transaction together with its schema_migrations row, so a failing
 * migration leaves no trace and the ones before it stay applied. Applied
 * versions are skipped, which makes a second run a no-op. Returns the file names
 * this call applied.
 */
export function migrate(db: Db, migrations: readonly Migration[] = loadMigrations()): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
  const findApplied = db.prepare<[number]>('SELECT 1 FROM schema_migrations WHERE version = ?');
  const recordApplied = db.prepare<[number, string]>(
    'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
  );
  const applyIfPending = db.transaction((migration: Migration): boolean => {
    if (findApplied.get(migration.version) !== undefined) {
      return false;
    }
    db.exec(migration.sql);
    recordApplied.run(migration.version, new Date().toISOString());
    return true;
  });

  const applied: string[] = [];
  for (const migration of migrations) {
    let ran: boolean;
    try {
      // IMMEDIATE takes the write lock before the check, so two processes
      // starting at once cannot both apply the same migration.
      ran = applyIfPending.immediate(migration);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.name} failed: ${reason}`, { cause: error });
    }
    if (ran) {
      applied.push(migration.name);
    }
  }
  return applied;
}
