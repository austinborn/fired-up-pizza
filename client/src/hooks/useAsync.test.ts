import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http';
import { useAsync } from './useAsync';

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

/** A fake loader whose calls the test settles one by one. */
function controlledLoader<T>() {
  const calls: { arg: string; signal: AbortSignal; result: Deferred<T> }[] = [];
  const load = vi.fn((arg: string, signal: AbortSignal) => {
    const result = deferred<T>();
    calls.push({ arg, signal, result });
    return result.promise;
  });
  const call = (index: number) => {
    const found = calls[index];
    if (!found) {
      throw new Error(`The loader was called ${calls.length} times, not ${index + 1}`);
    }
    return found;
  };
  return { load, call };
}

async function settle(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}

function renderUseAsync<T>(load: (arg: string, signal: AbortSignal) => Promise<T>, arg = 'a') {
  return renderHook(({ arg }) => useAsync((signal) => load(arg, signal), [arg]), {
    initialProps: { arg },
  });
}

describe('useAsync', () => {
  it('loads on mount', async () => {
    const { load, call } = controlledLoader<string>();
    const { result } = renderUseAsync(load);

    expect(result.current).toMatchObject({ data: undefined, error: null, isLoading: true });
    expect(load).toHaveBeenCalledExactlyOnceWith('a', expect.any(AbortSignal));

    await settle(() => call(0).result.resolve('menu'));

    expect(result.current).toMatchObject({ data: 'menu', error: null, isLoading: false });
  });

  it('reports a failure', async () => {
    const { load, call } = controlledLoader<string>();
    const { result } = renderUseAsync(load);
    const failure = new ApiError(0, 'NETWORK_ERROR', "Can't reach the server.");

    await settle(() => call(0).result.reject(failure));

    expect(result.current).toMatchObject({ data: undefined, error: failure, isLoading: false });
  });

  it('wraps a rejection that is not an Error in one', async () => {
    const { load, call } = controlledLoader<string>();
    const { result } = renderUseAsync(load);

    await settle(() => call(0).result.reject('boom'));

    expect(result.current.error).toEqual(new Error('boom'));
  });

  it('reports a synchronous throw from fn as a failure', async () => {
    const bug = new TypeError('fn threw before returning a promise');
    const { result } = renderHook(() =>
      useAsync<string>(() => {
        throw bug;
      }, []),
    );
    await settle(() => {});

    expect(result.current).toMatchObject({ data: undefined, error: bug, isLoading: false });
  });

  it('reload runs again and keeps the current data until the new result arrives', async () => {
    const { load, call } = controlledLoader<string>();
    const { result } = renderUseAsync(load);
    await settle(() => call(0).result.resolve('first'));

    act(() => result.current.reload());

    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: 'first', error: null, isLoading: true });

    await settle(() => call(1).result.resolve('second'));

    expect(result.current).toMatchObject({ data: 'second', error: null, isLoading: false });
  });

  it('a failed reload keeps the last good data next to the error', async () => {
    const { load, call } = controlledLoader<string>();
    const { result } = renderUseAsync(load);
    await settle(() => call(0).result.resolve('first'));

    act(() => result.current.reload());
    const failure = new Error('down');
    await settle(() => call(1).result.reject(failure));

    expect(result.current).toMatchObject({ data: 'first', error: failure, isLoading: false });
  });

  it('reload after a failure clears the error while the retry runs', async () => {
    const { load, call } = controlledLoader<string>();
    const { result } = renderUseAsync(load);
    await settle(() => call(0).result.reject(new Error('down')));

    act(() => result.current.reload());

    expect(result.current).toMatchObject({ error: null, isLoading: true });

    await settle(() => call(1).result.resolve('back'));

    expect(result.current).toMatchObject({ data: 'back', error: null, isLoading: false });
  });

  it('starts over when a dependency changes, dropping the old data at once', async () => {
    const { load, call } = controlledLoader<string>();
    const { result, rerender } = renderUseAsync(load);
    await settle(() => call(0).result.resolve('data for a'));

    rerender({ arg: 'b' });

    expect(result.current).toMatchObject({ data: undefined, error: null, isLoading: true });
    expect(load).toHaveBeenLastCalledWith('b', expect.any(AbortSignal));

    await settle(() => call(1).result.resolve('data for b'));

    expect(result.current).toMatchObject({ data: 'data for b', isLoading: false });
  });

  it('aborts and ignores a response for the old dependency', async () => {
    const { load, call } = controlledLoader<string>();
    const { result, rerender } = renderUseAsync(load);

    rerender({ arg: 'b' });

    expect(call(0).signal.aborted).toBe(true);

    await settle(() => call(0).result.resolve('late data for a'));

    expect(result.current).toMatchObject({ data: undefined, isLoading: true });

    await settle(() => call(1).result.resolve('data for b'));

    expect(result.current.data).toBe('data for b');
  });

  it('keeps the new data when the old dependency answers after it', async () => {
    const { load, call } = controlledLoader<string>();
    const { result, rerender } = renderUseAsync(load);
    rerender({ arg: 'b' });

    await settle(() => call(1).result.resolve('data for b'));
    await settle(() => call(0).result.resolve('late data for a'));

    expect(result.current).toMatchObject({ data: 'data for b', error: null, isLoading: false });
  });

  it('keeps the new data when the old dependency fails after it', async () => {
    const { load, call } = controlledLoader<string>();
    const { result, rerender } = renderUseAsync(load);
    rerender({ arg: 'b' });

    await settle(() => call(1).result.resolve('data for b'));
    await settle(() => call(0).result.reject(new Error('late failure for a')));

    expect(result.current).toMatchObject({ data: 'data for b', error: null, isLoading: false });
  });

  it('does not reload when the parent re-renders with the same dependency', () => {
    const { load } = controlledLoader<string>();
    const { rerender } = renderUseAsync(load);

    rerender({ arg: 'a' });

    expect(load).toHaveBeenCalledOnce();
  });

  it('aborts on unmount and ignores a response that arrives afterwards', async () => {
    const { load, call } = controlledLoader<string>();
    const { result, unmount } = renderUseAsync(load);

    unmount();

    expect(call(0).signal.aborted).toBe(true);

    await settle(() => call(0).result.resolve('too late'));

    expect(result.current).toMatchObject({ data: undefined, isLoading: true });
  });

  it('calls the latest function', async () => {
    const first = vi.fn(() => Promise.resolve('from the first render'));
    const latest = vi.fn(() => Promise.resolve('from the latest render'));
    // A new function with the same deps on purpose: it must be used without a restart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const { result, rerender } = renderHook(({ load }) => useAsync(load, []), {
      initialProps: { load: first },
    });
    await settle(() => {});

    rerender({ load: latest });
    act(() => result.current.reload());
    await settle(() => {});

    expect(first).toHaveBeenCalledOnce();
    expect(latest).toHaveBeenCalledOnce();
    expect(result.current.data).toBe('from the latest render');
  });
});
