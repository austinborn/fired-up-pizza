import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { LoadingState } from './LoadingState';

describe('LoadingState', () => {
  it('announces a default label as a status', () => {
    renderWithProviders(<LoadingState />);

    expect(screen.getByRole('status')).toHaveTextContent(/^Loading…$/);
  });

  it('announces a custom label', () => {
    renderWithProviders(<LoadingState label="Loading your orders…" />);

    expect(screen.getByRole('status')).toHaveTextContent(/^Loading your orders…$/);
  });
});
