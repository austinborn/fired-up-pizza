import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot register its own cleanup.
// localStorage is cleared too, so a cart that CartProvider saved in one test
// never shows up in the next.
afterEach(() => {
  cleanup();
  localStorage.clear();
});
