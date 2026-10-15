import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import { renderWithProviders } from '../test/render';
import { ErrorState } from './ErrorState';

const noop = () => {};

describe('ErrorState', () => {
  it("announces the failure as an alert with the API's message", () => {
    const error = new ApiError(
      0,
      'NETWORK_ERROR',
      "Can't reach the server. Check your connection and try again.",
    );

    renderWithProviders(
      <ErrorState title="Couldn't load your orders" error={error} onRetry={noop} />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load your orders");
    expect(alert).toHaveTextContent("Can't reach the server. Check your connection and try again.");
  });

  it('shows a generic message, not the raw text, for an error that is not from the API', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'items')");

    renderWithProviders(<ErrorState title="Couldn't load the menu" error={bug} onRetry={noop} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong. Please try again.');
    expect(alert).not.toHaveTextContent('Cannot read properties');
  });

  it('calls onRetry when "Try again" is pressed', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderWithProviders(
      <ErrorState title="Couldn't load the menu" error={new Error('down')} onRetry={onRetry} />,
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
