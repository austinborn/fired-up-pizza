import type { ReactNode } from 'react';
import { CartProvider } from './context/CartContext';

/**
 * Every app-wide React Context provider wraps the app here, in one place, so
 * main.tsx and the test render helper stay in sync (ADR 0007 rule 7).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <CartProvider>{children}</CartProvider>;
}
