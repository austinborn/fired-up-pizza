import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATABASE_PATH, DEFAULT_PORT, loadConfig } from './config';

describe('loadConfig', () => {
  it('needs no environment variables', () => {
    expect(loadConfig({})).toEqual({ port: DEFAULT_PORT, databasePath: DEFAULT_DATABASE_PATH });
  });

  it('keeps the default database inside server/data, which is gitignored', () => {
    expect(DEFAULT_DATABASE_PATH.split(path.sep).slice(-3)).toEqual([
      'server',
      'data',
      'fired-up-pizza.sqlite',
    ]);
  });

  it('reads PORT and DATABASE_PATH', () => {
    expect(loadConfig({ PORT: '4000', DATABASE_PATH: 'tmp/test.sqlite' })).toEqual({
      port: 4000,
      databasePath: path.resolve('tmp/test.sqlite'),
    });
  });

  it.each(['abc', '0', '70000', '3001.5'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT must be an integer/);
  });
});
