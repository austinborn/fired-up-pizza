import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_PORT = 3001;
export const DEFAULT_DATABASE_PATH = path.join(serverRoot, 'data', 'fired-up-pizza.sqlite');

export interface ServerConfig {
  port: number;
  databasePath: string;
}

/** Reads PORT and DATABASE_PATH; both are optional so `npm run dev` needs no setup. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${env.PORT}"`);
  }
  const databasePath = env.DATABASE_PATH ? path.resolve(env.DATABASE_PATH) : DEFAULT_DATABASE_PATH;
  return { port, databasePath };
}
