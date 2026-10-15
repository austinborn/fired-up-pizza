import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react';
import { useDepsVersion } from './useDepsVersion';

// Live data for a view, refreshed by polling (ADR 0007 rule 4): order
// tracking and the staff queue. There are no WebSockets or server-sent events.
//
//   const { data, error, isLoading, lastUpdatedAt, isStale, refresh } = usePolling(
//     (signal) => lookupOrders(phone, { signal }),
//     [phone],
//   );
//
// - fn runs at once, then every intervalMs, counted from the start of one poll
//   to the start of the next. A poll that takes longer than that delays the
//   next one, so requests never overlap.
// - A failed poll keeps the last good data and sets error and isStale. The
//   next success clears them. Polling carries on after failures.
// - While the page is hidden (another tab, a minimized window), no poll
//   starts after the first one, which loads the view even in a background
//   tab. When the page becomes visible again, it polls at once.
// - A change in deps aborts the poll in flight, drops the old data, and starts
//   over. Unmounting aborts the poll in flight and clears every timer.
// - fn itself may change on every render; the latest one is called.

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
/** ADR 0007 rule 4: live views refresh every 15 seconds at most. */
export const MAX_POLL_INTERVAL_MS = 15_000;
/** Keeps a mistaken 0 or negative interval from flooding the server. */
export const MIN_POLL_INTERVAL_MS = 1_000;

export interface PollingOptions {
  /** Time between the starts of two polls: 10 s by default, clamped to 1–15 s. */
  intervalMs?: number;
}

export interface PollingState<T> {
  /** The last good result for the current deps. A failed poll keeps it. */
  data: T | undefined;
  /** Why the latest poll failed; null after a success. */
  error: Error | null;
  /** No result yet: the first poll for the current deps, or a retry with nothing to show. */
  isLoading: boolean;
  /** When `data` arrived; null until the first success. */
  lastUpdatedAt: Date | null;
  /** The latest poll failed, so `data` is as of `lastUpdatedAt`. */
  isStale: boolean;
  /**
   * Polls now, e.g. after a staff action changed the data. If a poll is in
   * flight, one more starts as soon as it settles, so the result always
   * reflects everything that happened before the call. From the error state
   * (no data yet), it also shows loading again.
   */
  refresh: () => void;
}

interface Snapshot<T> {
  /** The useDepsVersion value this state belongs to. */
  version: number;
  data: T | undefined;
  error: Error | null;
  lastUpdatedAt: Date | null;
}

export function usePolling<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  { intervalMs = DEFAULT_POLL_INTERVAL_MS }: PollingOptions = {},
): PollingState<T> {
  const latestFn = useRef(fn);
  useLayoutEffect(() => {
    latestFn.current = fn;
  });

  const interval = clampInterval(intervalMs);
  const version = useDepsVersion(deps);
  const [stored, setStored] = useState(() => initial<T>(version));
  const refreshNow = useRef(noop);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | null = null;
    let pollAgain = false;

    function cancelTimer() {
      clearTimeout(timer);
      timer = undefined;
    }

    async function poll() {
      if (inFlight) {
        return;
      }
      cancelTimer();
      const controller = new AbortController();
      inFlight = controller;
      const startedAt = Date.now();
      try {
        const data = await latestFn.current(controller.signal);
        if (!stopped) {
          setStored({ version, data, error: null, lastUpdatedAt: new Date() });
        }
      } catch (reason) {
        if (!stopped) {
          setStored((prev) => ({ ...forVersion(prev, version), error: toError(reason) }));
        }
      }
      inFlight = null;
      if (stopped) {
        return;
      }
      if (pollAgain) {
        pollAgain = false;
        void poll();
      } else if (!document.hidden) {
        timer = setTimeout(() => void poll(), Math.max(0, startedAt + interval - Date.now()));
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        cancelTimer();
      } else {
        void poll();
      }
    }

    refreshNow.current = () => {
      setStored((prev) =>
        prev.version === version && prev.lastUpdatedAt === null && prev.error !== null
          ? { ...prev, error: null }
          : prev,
      );
      if (inFlight) {
        pollAgain = true;
      } else {
        void poll();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    void poll();

    return () => {
      stopped = true;
      cancelTimer();
      inFlight?.abort();
      refreshNow.current = noop;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [version, interval]);

  const refresh = useCallback(() => refreshNow.current(), []);

  const { data, error, lastUpdatedAt } = forVersion(stored, version);
  const hasData = lastUpdatedAt !== null;
  return {
    data,
    error,
    isLoading: !hasData && error === null,
    lastUpdatedAt,
    isStale: hasData && error !== null,
    refresh,
  };
}

/** NaN falls back to the default; anything else is clamped into the allowed range. */
function clampInterval(intervalMs: number): number {
  if (Number.isNaN(intervalMs)) {
    return DEFAULT_POLL_INTERVAL_MS;
  }
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, intervalMs));
}

function initial<T>(version: number): Snapshot<T> {
  return { version, data: undefined, error: null, lastUpdatedAt: null };
}

/** `snapshot` if it belongs to `version`, otherwise the starting state for that version. */
function forVersion<T>(snapshot: Snapshot<T>, version: number): Snapshot<T> {
  return snapshot.version === version ? snapshot : initial(version);
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

function noop() {}
