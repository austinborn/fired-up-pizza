import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
} from 'react';
import { useDepsVersion } from './useDepsVersion';

// One-shot data loading for a view (ADR 0007 rules 3 and 5). Pass a function
// that calls client/src/api/ and forwards the AbortSignal:
//
//   const { data, error, isLoading, reload } = useAsync(
//     (signal) => getMenuItem(menuItemId, { signal }),
//     [menuItemId],
//   );
//
// fn runs on mount and again whenever a value in deps changes. A new run
// aborts the previous request and ignores its result, so a slow response for
// old deps, or one that arrives after unmount, never overwrites current state.
// fn itself may change on every render; the latest one is called.

export interface AsyncState<T> {
  /** The latest result for the current deps; undefined until one arrives. A failed reload keeps it. */
  data: T | undefined;
  /** Why the latest run failed; null while it runs and after a success. */
  error: Error | null;
  /** True while a run is in flight. */
  isLoading: boolean;
  /** Runs fn again for the same deps. `data` stays until the new result arrives. */
  reload: () => void;
}

interface Snapshot<T> {
  /** The useDepsVersion value this state belongs to. */
  version: number;
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
}

export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): AsyncState<T> {
  const latestFn = useRef(fn);
  useLayoutEffect(() => {
    latestFn.current = fn;
  });

  const version = useDepsVersion(deps);
  const [stored, setStored] = useState(() => loading<T>(version));
  const [runCount, setRunCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const data = await latestFn.current(controller.signal);
        if (!controller.signal.aborted) {
          setStored({ version, data, error: null, isLoading: false });
        }
      } catch (reason) {
        if (!controller.signal.aborted) {
          setStored((prev) => ({
            ...forVersion(prev, version),
            error: toError(reason),
            isLoading: false,
          }));
        }
      }
    })();
    return () => controller.abort();
  }, [version, runCount]);

  const reload = useCallback(() => {
    setStored((prev) => ({ ...forVersion(prev, version), error: null, isLoading: true }));
    setRunCount((count) => count + 1);
  }, [version]);

  const { data, error, isLoading } = forVersion(stored, version);
  return { data, error, isLoading, reload };
}

function loading<T>(version: number): Snapshot<T> {
  return { version, data: undefined, error: null, isLoading: true };
}

/** `snapshot` if it belongs to `version`, otherwise the starting state for that version. */
function forVersion<T>(snapshot: Snapshot<T>, version: number): Snapshot<T> {
  return snapshot.version === version ? snapshot : loading(version);
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
