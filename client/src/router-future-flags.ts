// Opt in to React Router v7 behavior now so v6 stops logging upgrade warnings
// in the browser and in tests.
export const ROUTER_FUTURE_FLAGS = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const;
