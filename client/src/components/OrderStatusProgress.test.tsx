import type { OrderStatus } from '@fired-up-pizza/shared';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { OrderStatusProgress } from './OrderStatusProgress';

/** Each step's text, with " <- current" after the one marked as the current step. */
function steps(): string[] {
  const list = screen.getByRole('list', { name: 'Order status' });
  return within(list)
    .getAllByRole('listitem')
    .map((step) =>
      step.getAttribute('aria-current') === 'step'
        ? `${step.textContent} <- current`
        : (step.textContent ?? ''),
    );
}

// A file's first render pays for warming up React and jsdom, which took over
// 3 s under two concurrent full suites, so each test gets 15 s.
describe('OrderStatusProgress', { timeout: 15_000 }, () => {
  // The path is written out here as the test's oracle; the component reads it
  // from the shared transition table.
  it.each<{ status: OrderStatus; expected: string[] }>([
    { status: 'placed', expected: ['Placed <- current', 'Preparing', 'Ready', 'Delivered'] },
    {
      status: 'preparing',
      expected: ['Placed, done', 'Preparing <- current', 'Ready', 'Delivered'],
    },
    {
      status: 'ready',
      expected: ['Placed, done', 'Preparing, done', 'Ready <- current', 'Delivered'],
    },
    {
      status: 'delivered',
      expected: ['Placed, done', 'Preparing, done', 'Ready, done', 'Delivered <- current'],
    },
  ])('marks $status as the current step, after the steps it has passed', ({ status, expected }) => {
    renderWithProviders(<OrderStatusProgress status={status} />);

    expect(steps()).toEqual(expected);
  });

  it('shows a cancelled order as cancelled instead of the steps it left', () => {
    const { container } = renderWithProviders(<OrderStatusProgress status="cancelled" />);

    expect(screen.queryByRole('list', { name: 'Order status' })).not.toBeInTheDocument();
    expect(container).toHaveTextContent(/^Cancelled\. This order won't be made\.$/);
  });
});
