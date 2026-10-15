import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, type Db } from './connection';
import {
  MIGRATIONS_DIR,
  loadMigrations,
  migrate,
  orderMigrationFiles,
  type Migration,
} from './migrate';

const DOMAIN_TABLES = [
  'menu_items',
  'sizes',
  'crusts',
  'toppings',
  'orders',
  'order_items',
  'order_item_toppings',
  'order_status_events',
];

function tableNames(db: Db): string[] {
  return db
    .prepare<[], string>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
    .pluck()
    .all();
}

function appliedVersions(db: Db): number[] {
  return db
    .prepare<[], number>('SELECT version FROM schema_migrations ORDER BY version')
    .pluck()
    .all();
}

function migration(version: number, sql: string): Migration {
  return { version, name: `${String(version).padStart(4, '0')}_test.sql`, sql };
}

describe('orderMigrationFiles', () => {
  it('orders files by name and reads the version from the prefix', () => {
    expect(orderMigrationFiles(['0010_c.sql', '0002_b.sql', '0001_a.sql'])).toEqual([
      { version: 1, name: '0001_a.sql' },
      { version: 2, name: '0002_b.sql' },
      { version: 10, name: '0010_c.sql' },
    ]);
  });

  it('ignores files that are not SQL, such as tests next to the migrations', () => {
    expect(orderMigrationFiles(['0001_initial.test.ts', 'README.md', '0001_initial.sql'])).toEqual([
      { version: 1, name: '0001_initial.sql' },
    ]);
  });

  it.each(['1_initial.sql', '0001-initial.sql', '0001_Initial.sql', '0001.sql', 'initial.sql'])(
    'rejects the misnamed file %s',
    (name) => {
      expect(() => orderMigrationFiles([name])).toThrow(
        `Migration file ${name} must be named NNNN_description.sql`,
      );
    },
  );

  it('rejects two files with the same version', () => {
    expect(() => orderMigrationFiles(['0002_add_b.sql', '0002_add_a.sql'])).toThrow(
      'Migrations 0002_add_a.sql and 0002_add_b.sql share version 0002',
    );
  });
});

describe('loadMigrations', () => {
  it('reads server/src/db/migrations, relative to the runner module', () => {
    expect(MIGRATIONS_DIR.split(path.sep).slice(-4)).toEqual(['server', 'src', 'db', 'migrations']);
  });

  it('starts with 0001_initial.sql and keeps versions increasing', () => {
    const migrations = loadMigrations();
    const versions = migrations.map((m) => m.version);

    expect(migrations[0]).toMatchObject({ version: 1, name: '0001_initial.sql' });
    expect(migrations[0]?.sql).toContain('CREATE TABLE orders');
    expect(versions).toEqual(versions.toSorted((a, b) => a - b));
  });
});

describe('migrate', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase(IN_MEMORY);
  });

  afterEach(() => {
    db.close();
  });

  it('builds every domain table in an empty in-memory database', () => {
    const migrations = loadMigrations();

    expect(migrate(db)).toEqual(migrations.map((m) => m.name));
    expect(tableNames(db)).toEqual(expect.arrayContaining([...DOMAIN_TABLES, 'schema_migrations']));
    expect(appliedVersions(db)).toEqual(migrations.map((m) => m.version));
  });

  it('records when each version was applied, as an ISO-8601 UTC timestamp', () => {
    const before = new Date().toISOString();
    migrate(db);
    const after = new Date().toISOString();

    const rows = db
      .prepare<[], { version: number; applied_at: string }>('SELECT * FROM schema_migrations')
      .all();
    for (const row of rows) {
      expect(row.applied_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(row.applied_at >= before && row.applied_at <= after).toBe(true);
    }
  });

  it('is a no-op the second time, keeping schema and data', () => {
    migrate(db);
    db.prepare("INSERT INTO sizes (name, price_multiplier) VALUES ('Small', 1)").run();
    const recorded = db.prepare('SELECT * FROM schema_migrations').all();

    expect(migrate(db)).toEqual([]);
    expect(db.prepare('SELECT * FROM schema_migrations').all()).toEqual(recorded);
    expect(db.prepare('SELECT name FROM sizes').pluck().all()).toEqual(['Small']);
  });

  it('applies only the migrations newer than the existing schema', () => {
    const first = migration(1, 'CREATE TABLE widgets (id INTEGER PRIMARY KEY);');
    const second = migration(2, 'ALTER TABLE widgets ADD COLUMN label TEXT;');

    expect(migrate(db, [first])).toEqual(['0001_test.sql']);
    db.prepare('INSERT INTO widgets (id) VALUES (7)').run();

    expect(migrate(db, [first, second])).toEqual(['0002_test.sql']);
    expect(appliedVersions(db)).toEqual([1, 2]);
    expect(db.prepare('SELECT id, label FROM widgets').all()).toEqual([{ id: 7, label: null }]);
  });

  it('runs each migration in its own transaction and stops at the first failure', () => {
    const migrations = [
      migration(1, 'CREATE TABLE first_table (id INTEGER PRIMARY KEY);'),
      migration(
        2,
        'CREATE TABLE second_table (id INTEGER PRIMARY KEY); INSERT INTO missing_table VALUES (1);',
      ),
      migration(3, 'CREATE TABLE third_table (id INTEGER PRIMARY KEY);'),
    ];

    expect(() => migrate(db, migrations)).toThrow(
      'Migration 0002_test.sql failed: no such table: missing_table',
    );
    expect(tableNames(db)).toContain('first_table');
    expect(tableNames(db)).not.toContain('second_table');
    expect(tableNames(db)).not.toContain('third_table');
    expect(appliedVersions(db)).toEqual([1]);
  });

  it('migrates an empty database file, which then needs nothing on reopen', () => {
    // Migrating an empty file is file-only behavior, so it gets a throwaway
    // temp directory (ADR 0002 rule 2).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fired-up-pizza-'));
    const filename = path.join(dir, 'app.sqlite');
    try {
      const fileDb = openDatabase(filename);
      try {
        expect(migrate(fileDb)).toEqual(loadMigrations().map((m) => m.name));
      } finally {
        fileDb.close();
      }

      const reopened = openDatabase(filename);
      try {
        expect(migrate(reopened)).toEqual([]);
        expect(tableNames(reopened)).toEqual(expect.arrayContaining(DOMAIN_TABLES));
      } finally {
        reopened.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
