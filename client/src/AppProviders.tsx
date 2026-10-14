import type { ReactNode } from 'react';

/**
 * Every app-wide React Context provider wraps the app here, in one place, so
 * main.tsx and the test render helper stay in sync. The cart work item adds
 * CartProvider (ADR 0007).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
