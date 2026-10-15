import { errorMessage } from '../api/http';

interface ErrorStateProps {
  /** What failed, e.g. "Couldn't load the menu". */
  title: string;
  /** The hook's `error`. An ApiError shows its own message; anything else shows a generic one. */
  error: unknown;
  /** Runs when the "Try again" button is pressed: useAsync's reload or usePolling's refresh. */
  onRetry: () => void;
}

/**
 * A view whose data failed to load and that has nothing else to show (ADR
 * 0007 rule 5). A polled view that still has data shows StaleDataBanner
 * instead. role="alert" makes screen readers announce the failure at once.
 */
export function ErrorState({ title, error, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center text-red-900"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-red-800">{errorMessage(error)}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
      >
        Try again
      </button>
    </div>
  );
}
