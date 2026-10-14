import { defineConfig } from 'vitest/config';

// `npm test` runs every workspace as its own Vitest project. Each project keeps
// its own config (environment, setup files) next to its package.json.
export default defineConfig({
  test: {
    projects: ['shared', 'server', 'client'],
  },
});
