import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson } from '../api/http';
import { usePolling } from '../hooks/usePolling';
import { renderWithProviders } from '../test/render';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { StaleDataBanner } from './StaleDataBanner';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('StaleDataBanner', () => {
  it('says when the data on screen was last updated, as a status', () => {
    const lastUpdatedAt = new Date(2026, 9, 14, 18, 5, 42);

    renderWithProviders(<StaleDataBanner lastUpdatedAt={lastUpdatedAt} />);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      "Couldn't refresh. Last updated at 6:05 PM. Retrying automatically.",
    );
    const time = within(banner).getByText('6:05 PM');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('datetime', lastUpdatedAt.toISOString());
  });

  it('accepts an ISO timestamp from the API', () => {
    const lastUpdatedAt = new Date(2026, 9, 14, 9, 30);

    renderWithProviders(<StaleDataBanner lastUpdatedAt={lastUpdatedAt.toISOString()} />);

    expect(screen.getByRole('status')).toHaveTextContent('Last updated at 9:30 AM.');
  });

  it('still explains itself when there is no time to show', () => {
    renderWithProviders(<StaleDataBanner lastUpdatedAt={null} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      /^Couldn't refresh\. Retrying automatically\.$/,
    );
  });
});

// How a live view puts the pieces together: the http helper, usePolling, and
// every view state, driven through a mocked fetch and fake timers.
function LiveOrderCount() {
  const { data, error, isLoading, isStale, lastUpdatedAt, refresh } = usePolling(
    (signal) => getJson<{ id: number }[]>('/api/staff/orders', { signal }),
    [],
  );
  if (isLoading) {
    return <LoadingState label="Loading orders…" />;
  }
  if (data === undefined) {
    return <ErrorState title="Couldn't load orders" error={error} onRetry={refresh} />;
  }
  return (
    <>
      {isStale ? <StaleDataBanner lastUpdatedAt={lastUpdatedAt} /> : null}
      {data.length === 0 ? <EmptyState title="No live orders" /> : <p>{data.length} live</p>}
    </>
  );
}

describe('a polled view built from these parts', () => {
  const ordersResponse = (count: number) =>
    new Response(JSON.stringify(Array.from({ length: count }, (_, id) => ({ id }))), {
      headers: { 'Content-Type': 'application/json' },
    });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  /** Each poll gets the next response; a poll beyond the script fails the test loudly. */
  function scriptFetch(...responses: (Response | Error)[]) {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('The test expected no more polls'));
    for (const response of responses) {
      if (response instanceof Error) {
        fetchSpy.mockRejectedValueOnce(response);
      } else {
        fetchSpy.mockResolvedValueOnce(response);
      }
    }
    return fetchSpy;
  }

  it('keeps the last good data under a stale banner while polls fail, then recovers', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 14, 18, 5) });
    const fetchSpy = scriptFetch(
      ordersResponse(0),
      ordersResponse(2),
      new TypeError('Failed to fetch'),
      new Response(null, { status: 502 }),
      ordersResponse(3),
    );

    renderWithProviders(<LiveOrderCount />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading orders…');

    await advance(0);
    expect(screen.getByRole('status')).toHaveTextContent('No live orders');

    await advance(10_000);
    expect(screen.getByText('2 live')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // The poll at 6:05:20 PM cannot reach the server, and the one at 6:05:30
    // PM gets the dev proxy's empty 502: both keep the 6:05:10 PM data.
    await advance(10_000);
    expect(screen.getByText('2 live')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Last updated at 6:05 PM.');

    await advance(10_000);
    expect(screen.getByText('2 live')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Last updated at 6:05 PM.');

    await advance(10_000);
    expect(screen.getByText('3 live')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('shows the error with a working retry when there is nothing to show yet', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 14, 18, 5) });
    scriptFetch(new TypeError('Failed to fetch'), ordersResponse(1));

    renderWithProviders(<LiveOrderCount />);
    await advance(0);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load orders");
    expect(alert).toHaveTextContent("Can't reach the server.");

    await act(async () => {
      within(alert).getByRole('button', { name: 'Try again' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('1 live')).toBeInTheDocument();
  });
});
