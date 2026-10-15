import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    'server/data/',
    '.beads/',
    '.claude/',
    '.gc/',
    'worktrees/',
    'docs/.agents/',
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['server/**/*.ts', 'shared/**/*.ts', '*.{js,ts}', '*/*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      // useAsync and usePolling take a deps list like useEffect, so check it
      // the same way: a missing dep would show one input's data under another.
      'react-hooks/exhaustive-deps': ['warn', { additionalHooks: '^(useAsync|usePolling)$' }],
    },
  },
  {
    // Tests and test utilities export helpers alongside components and work
    // with untyped HTTP/JSON payloads (supertest, mocked fetch).
    files: ['**/*.test.{ts,tsx}', 'client/src/test/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // Tooling config files sit outside the workspace tsconfigs.
    files: ['**/*.js', '*.config.ts', '*/*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
