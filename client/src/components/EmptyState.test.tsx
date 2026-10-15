import { screen, within } from '@testing-library/react';
import { Link } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('announces its title as a status', () => {
    renderWithProviders(<EmptyState title="No live orders" />);

    expect(screen.getByRole('status')).toHaveTextContent(/^No live orders$/);
  });

  it('shows a hint or next step from its children', () => {
    renderWithProviders(
      <EmptyState title="No orders for this number">
        <Link to="/">Order a pizza</Link>
      </EmptyState>,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No orders for this number');
    expect(within(status).getByRole('link', { name: 'Order a pizza' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
