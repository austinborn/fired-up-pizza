import { useState, type DependencyList } from 'react';

/**
 * A number that changes whenever a value in `deps` changes (compared with
 * Object.is, as useEffect does). useAsync and usePolling use it in two ways:
 * - as their effect dependency, so the work restarts when the deps change;
 * - as a tag on every result, so a view never shows one deps' data under
 *   another, even when a response for the old deps lands late.
 *
 * It tracks the deps with React's "storing information from previous renders"
 * pattern: React re-renders at once when state is set during render, before
 * anything is committed.
 */
export function useDepsVersion(deps: DependencyList): number {
  const [tracked, setTracked] = useState({ deps, version: 0 });
  if (!sameDeps(tracked.deps, deps)) {
    const version = tracked.version + 1;
    setTracked({ deps, version });
    return version;
  }
  return tracked.version;
}

function sameDeps(a: DependencyList, b: DependencyList): boolean {
  return a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}
