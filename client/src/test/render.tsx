import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AppProviders } from '../AppProviders';
import { ROUTER_FUTURE_FLAGS } from '../router-future-flags';

/** Renders UI inside the same providers as main.tsx, at the given route. */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/' }: { route?: string } = {},
): RenderResult {
  return render(
    <MemoryRouter initialEntries={[route]} future={ROUTER_FUTURE_FLAGS}>
      <AppProviders>{ui}</AppProviders>
    </MemoryRouter>,
  );
}

/** Renders the whole app (route table + layouts) at the given route. */
export function renderApp(route = '/'): RenderResult {
  return renderWithProviders(<App />, { route });
}
