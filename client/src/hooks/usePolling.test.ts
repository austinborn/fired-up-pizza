import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import { MAX_POLL_INTERVAL_MS, usePolling } from './usePolling';

const START = new Date(2026, 9, 14, 18, 0, 0);
const at = (ms: number) => new Date(START.getTime() + ms);

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/**
 * A fake poll function whose calls the test settles one by one. It records
 * how many calls were ever in flight at once, to prove polls never overlap.
 */
function controlledPoll<T>() {
  const calls: { arg: string; signal: AbortSignal; result: Deferred<T> }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const poll = vi.fn((arg: string, signal: AbortSignal) => {
    const result = deferred<T>();
    calls.push({ arg, signal, result });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const done = () => {
      inFlight -= 1;
    };
    result.promise.then(done, done);
    return result.promise;
  });
  const call = (index: number) => {
    const found = calls[index];
    if (!found) {
      throw new Error(`The poll function was called ${calls.length} times, not ${index + 1}`);
    }
    return found;
  };
  return { poll, call, maxInFlight: () => maxInFlight };
}

/** A poll function that answers at once with 1, 2, 3, … */
function countingPoll() {
  let count = 0;
  return vi.fn((_arg: string, _signal: AbortSignal) => Promise.resolve((count += 1)));
}

function renderUsePolling<T>(
  poll: (arg: string, signal: AbortSignal) => Promise<T>,
  { arg = 'a', intervalMs }: { arg?: string; intervalMs?: number } = {},
) {
  return renderHook(({ arg }) => usePolling((signal) => poll(arg, signal), [arg], { intervalMs }), {
    initialProps: { arg },
  });
}

/** Advances fake time, letting promise callbacks and React updates run along the way. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Runs `action`, then lets the promise callbacks and React updates it causes run. */
async function settle(action: () => void = () => {}) {
  await act(async () => {
    action();
    await vi.advanceTimersByTimeAsync(0);
  });
}

function setPageHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers({ now: START });
});

afterEach(() => {
  vi.useRealTimers();
  // Drop setPageHidden's override so document.hidden reads from jsdom again.
  Reflect.deleteProperty(document, 'hidden');
});

describe('usePolling: schedule', () => {
  it('polls at once, then every 10 seconds by default', async () => {
    const poll = countingPoll();
    const { result } = renderUsePolling(poll);

    expect(poll).toHaveBeenCalledOnce();
    expect(result.current).toMatchObject({
      data: undefined,
      error: null,
      isLoading: true,
      isStale: false,
      lastUpdatedAt: null,
    });

    await settle();

    expect(result.current).toMatchObject({
      data: 1,
      error: null,
      isLoading: false,
      isStale: false,
      lastUpdatedAt: START,
    });

    await advance(9_999);
    expect(poll).toHaveBeenCalledOnce();

    await advance(1);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: 2, lastUpdatedAt: at(10_000) });

    await advance(10_000);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(result.current).toMatchObject({ data: 3, lastUpdatedAt: at(20_000) });
  });

  it('uses a custom interval', async () => {
    const poll = countingPoll();
    renderUsePolling(poll, { intervalMs: 5_000 });
    await settle();

    await advance(4_999);
    expect(poll).toHaveBeenCalledOnce();

    await advance(1);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('clamps an interval above 15 seconds to 15 seconds (ADR 0007 rule 4)', async () => {
    expect(MAX_POLL_INTERVAL_MS).toBe(15_000);
    const poll = countingPoll();
    renderUsePolling(poll, { intervalMs: 60_000 });
    await settle();

    await advance(14_999);
    expect(poll).toHaveBeenCalledOnce();

    await advance(1);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it.each([
    [0, 1_000],
    [-5_000, 1_000],
    [Number.NaN, 10_000],
  ])(
    'treats an interval of %d ms as %d ms, so a mistake cannot flood the server',
    async (intervalMs, effectiveMs) => {
      const poll = countingPoll();
      renderUsePolling(poll, { intervalMs });
      await settle();

      await advance(effectiveMs - 1);
      expect(poll).toHaveBeenCalledOnce();

      await advance(1);
      expect(poll).toHaveBeenCalledTimes(2);
    },
  );

  it('counts the interval from the start of one poll to the start of the next', async () => {
    const { poll, call } = controlledPoll<string>();
    renderUsePolling(poll);

    await advance(3_000);
    await settle(() => call(0).result.resolve('took 3 seconds'));
    await advance(6_999);
    expect(poll).toHaveBeenCalledOnce();

    await advance(1);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('never overlaps: a poll slower than the interval delays the next one', async () => {
    const { poll, call, maxInFlight } = controlledPoll<string>();
    renderUsePolling(poll);

    await advance(60_000);
    expect(poll).toHaveBeenCalledOnce();

    // The next poll is overdue, so it starts as soon as the slow one settles.
    await settle(() => call(0).result.resolve('took a minute'));
    expect(poll).toHaveBeenCalledTimes(2);

    await settle(() => call(1).result.resolve('quick'));
    await advance(9_999);
    expect(poll).toHaveBeenCalledTimes(2);

    await advance(1);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(maxInFlight()).toBe(1);
  });

  it('does not restart when the parent re-renders with the same dependencies', async () => {
    const poll = countingPoll();
    const { rerender } = renderUsePolling(poll);
    await settle();

    rerender({ arg: 'a' });
    await advance(9_999);

    expect(poll).toHaveBeenCalledOnce();
  });

  it('calls the latest function', async () => {
    const first = vi.fn(() => Promise.resolve('from the first render'));
    const latest = vi.fn(() => Promise.resolve('from the latest render'));
    // A new function with the same deps on purpose: it must be used without a restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const { result, rerender } = renderHook(({ poll }) => usePolling(poll, []), {
      initialProps: { poll: first },
    });
    await settle();

    rerender({ poll: latest });
    await advance(10_000);

    expect(first).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
    expect(result.current.data).toBe('from the latest render');
  });
});

describe('usePolling: failures', () => {
  const outage = new ApiError(0, 'NETWORK_ERROR', "Can't reach the server.");

  it('keeps the last good data and marks it stale when a poll fails', async () => {
    const { poll, call } = controlledPoll<string[]>();
    const { result } = renderUsePolling(poll);
    await settle(() => call(0).result.resolve(['order 1']));

    await advance(10_000);
    await settle(() => call(1).result.reject(outage));

    expect(result.current).toMatchObject({
      data: ['order 1'],
      error: outage,
      isLoading: false,
      isStale: true,
      lastUpdatedAt: START,
    });
  });

  it('keeps polling through failures and recovers on the next success', async () => {
    const { poll, call } = controlledPoll<string[]>();
    const { result } = renderUsePolling(poll);
    await settle(() => call(0).result.resolve(['order 1']));
    await advance(10_000);
    await settle(() => call(1).result.reject(outage));
    await advance(10_000);
    await settle(() => call(2).result.reject(new Error('still down')));

    expect(result.current).toMatchObject({
      data: ['order 1'],
      error: new Error('still down'),
      isStale: true,
      lastUpdatedAt: START,
    });

    await advance(10_000);
    await settle(() => call(3).result.resolve(['order 1', 'order 2']));

    expect(result.current).toMatchObject({
      data: ['order 1', 'order 2'],
      error: null,
      isLoading: false,
      isStale: false,
      lastUpdatedAt: at(30_000),
    });
  });

  it('reports a failed first poll as an error with nothing stale, and keeps polling', async () => {
    const { poll, call } = controlledPoll<string[]>();
    const { result } = renderUsePolling(poll);

    await settle(() => call(0).result.reject(outage));

    expect(result.current).toMatchObject({
      data: undefined,
      error: outage,
      isLoading: false,
      isStale: false,
      lastUpdatedAt: null,
    });

    await advance(10_000);
    await settle(() => call(1).result.resolve([]));

    expect(result.current).toMatchObject({ data: [], error: null, isLoading: false });
  });

  it('wraps a rejection that is not an Error in one', async () => {
    const { poll, call } = controlledPoll<string>();
    const { result } = renderUsePolling(poll);

    await settle(() => call(0).result.reject('boom'));

    expect(result.current.error).toEqual(new Error('boom'));
  });

  it('treats a synchronous throw from fn as a failed poll and keeps polling', async () => {
    const bug = new TypeError('fn threw before returning a promise');
    const poll = vi.fn<(signal: AbortSignal) => Promise<string>>(() => {
      throw bug;
    });
    const { result } = renderHook(() => usePolling(poll, []));
    await settle();

    expect(result.current).toMatchObject({ error: bug, isLoading: false });

    await advance(10_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});

describe('usePolling: refresh', () => {
  it('polls at once and restarts the interval from there', async () => {
    const poll = countingPoll();
    const { result } = renderUsePolling(poll);
    await settle();
    await advance(4_000);

    await settle(() => result.current.refresh());

    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: 2, lastUpdatedAt: at(4_000) });

    await advance(9_999);
    expect(poll).toHaveBeenCalledTimes(2);

    await advance(1);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('keeps showing the current data while it refreshes', async () => {
    const { poll, call } = controlledPoll<string>();
    const { result } = renderUsePolling(poll);
    await settle(() => call(0).result.resolve('queue'));

    await settle(() => result.current.refresh());

    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: 'queue', isLoading: false });
  });

  it('during a poll in flight, runs exactly one more poll as soon as it settles', async () => {
    const { poll, call, maxInFlight } = controlledPoll<string>();
    const { result } = renderUsePolling(poll);

    await settle(() => {
      result.current.refresh();
      result.current.refresh();
    });
    expect(poll).toHaveBeenCalledOnce();

    // The poll in flight may predate the change that prompted the refresh,
    // so its result is shown and then replaced by the extra poll's.
    await settle(() => call(0).result.resolve('before the staff action'));
    expect(poll).toHaveBeenCalledTimes(2);

    await settle(() => call(1).result.resolve('after the staff action'));
    expect(result.current.data).toBe('after the staff action');
    expect(poll).toHaveBeenCalledTimes(2);
    expect(maxInFlight()).toBe(1);
  });

  it('after a failed first poll, shows loading again while it retries', async () => {
    const { poll, call } = controlledPoll<string>();
    const { result } = renderUsePolling(poll);
    await settle(() => call(0).result.reject(new Error('down')));

    await settle(() => result.current.refresh());

    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ error: null, isLoading: true, isStale: false });

    await settle(() => call(1).result.resolve('back'));

    expect(result.current).toMatchObject({ data: 'back', error: null, isLoading: false });
  });

  it('keeps stale data marked stale until the refresh succeeds', async () => {
    const { poll, call } = controlledPoll<string>();
    const { result } = renderUsePolling(poll);
    await settle(() => call(0).result.resolve('queue'));
    await advance(10_000);
    await settle(() => call(1).result.reject(new Error('down')));

    await settle(() => result.current.refresh());

    expect(result.current).toMatchObject({ data: 'queue', isStale: true, isLoading: false });

    await settle(() => call(2).result.resolve('fresh queue'));

    expect(result.current).toMatchObject({ data: 'fresh queue', isStale: false, error: null });
  });
});

describe('usePolling: page visibility', () => {
  it('pauses while the page is hidden and polls at once when it is shown again', async () => {
    const poll = countingPoll();
    const { result } = renderUsePolling(poll);
    await settle();

    await settle(() => setPageHidden(true));
    await advance(60_000);
    expect(poll).toHaveBeenCalledOnce();

    await settle(() => setPageHidden(false));
    expect(poll).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: 2, lastUpdatedAt: at(60_000) });

    await advance(10_000);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('schedules nothing when a poll settles while the page is hidden', async () => {
    const { poll, call } = controlledPoll<string>();
    renderUsePolling(poll);

    await settle(() => setPageHidden(true));
    await settle(() => call(0).result.resolve('ok'));
    await advance(60_000);
    expect(poll).toHaveBeenCalledOnce();

    await settle(() => setPageHidden(false));
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('still loads once when it mounts in a hidden page, then waits until the page is shown', async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    const poll = countingPoll();
    const { result } = renderUsePolling(poll);
    await settle();

    expect(result.current.data).toBe(1);
    await advance(60_000);
    expect(poll).toHaveBeenCalledOnce();

    await settle(() => setPageHidden(false));
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('does not start a second poll when the page is shown while one is in flight', async () => {
    const { poll, maxInFlight } = controlledPoll<string>();
    renderUsePolling(poll);

    await settle(() => setPageHidden(true));
    await settle(() => setPageHidden(false));

    expect(poll).toHaveBeenCalledOnce();
    expect(maxInFlight()).toBe(1);
  });
});

describe('usePolling: cleanup and dependency changes', () => {
  it('on unmount, clears the timer and stops listening for visibility changes', async () => {
    const poll = countingPoll();
    const { unmount } = renderUsePolling(poll);
    await settle();

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await settle(() => {
      setPageHidden(true);
      setPageHidden(false);
    });
    await advance(60_000);
    expect(poll).toHaveBeenCalledOnce();
  });

  it('on unmount, aborts the poll in flight and ignores its result', async () => {
    const { poll, call } = controlledPoll<string>();
    const { result, unmount } = renderUsePolling(poll);
    await settle(() => call(0).result.resolve('first'));
    await advance(10_000);

    unmount();

    expect(call(1).signal.aborted).toBe(true);
    await settle(() => call(1).result.resolve('too late'));
    await advance(60_000);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.data).toBe('first');
  });

  it('starts over when a dependency changes: old data goes at once and the new deps poll at once', async () => {
    const { poll, call } = controlledPoll<string>();
    const { result, rerender } = renderUsePolling(poll, { arg: '+12125550142' });
    await settle(() => call(0).result.resolve('orders for the first phone'));

    rerender({ arg: '+12125550199' });

    expect(result.current).toMatchObject({
      data: undefined,
      error: null,
      isLoading: true,
      isStale: false,
      lastUpdatedAt: null,
    });
    expect(poll).toHaveBeenCalledTimes(2);
    expect(call(1).arg).toBe('+12125550199');

    await settle(() => call(1).result.resolve('orders for the second phone'));
    expect(result.current.data).toBe('orders for the second phone');

    await advance(10_000);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(call(2).arg).toBe('+12125550199');
  });

  it('aborts and ignores a poll still in flight for the old dependency', async () => {
    const { poll, call } = controlledPoll<string>();
    const { result, rerender } = renderUsePolling(poll, { arg: '+12125550142' });

    rerender({ arg: '+12125550199' });

    expect(call(0).signal.aborted).toBe(true);
    // Even if the old request still answers, its data never shows.
    await settle(() => call(0).result.resolve('late orders for the first phone'));
    expect(result.current).toMatchObject({ data: undefined, isLoading: true });

    await settle(() => call(1).result.reject(new Error('down')));
    expect(result.current).toMatchObject({ data: undefined, isStale: false, isLoading: false });
  });

  it.each([
    ['answers', (old: Deferred<string>) => old.resolve('late orders for the first phone')],
    ['fails', (old: Deferred<string>) => old.reject(new Error('late failure'))],
  ])('keeps the new data when the old dependency %s after it', async (_case, finishOld) => {
    const { poll, call } = controlledPoll<string>();
    const { result, rerender } = renderUsePolling(poll, { arg: '+12125550142' });
    rerender({ arg: '+12125550199' });

    await settle(() => call(1).result.resolve('orders for the second phone'));
    await settle(() => finishOld(call(0).result));

    expect(result.current).toMatchObject({
      data: 'orders for the second phone',
      error: null,
      isStale: false,
    });
  });
});
