import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, createDatabasePing, openDatabase } from './connection';

describe('openDatabase', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces foreign keys on in-memory databases', () => {
    const db = openDatabase(IN_MEMORY);
    try {
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  it('creates missing directories and uses WAL for file databases', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fired-up-pizza-'));
    tempDirs.push(dir);
    const filename = path.join(dir, 'nested', 'app.sqlite');

    const db = openDatabase(filename);
    try {
      expect(fs.existsSync(filename)).toBe(true);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe('createDatabasePing', () => {
  it('passes while the database answers and throws once it is closed', () => {
    const db = openDatabase(IN_MEMORY);
    const ping = createDatabasePing(db);

    expect(ping).not.toThrow();
    db.close();
    expect(ping).toThrow();
  });
});
