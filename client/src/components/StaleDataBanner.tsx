import { formatTime, type Timestamp } from '../lib/time';

/**
 * Goes above a polled view whose latest poll failed (usePolling's isStale),
 * while the view keeps showing its last good data (ADR 0007 rule 5). Polling
 * retries on its own, so the banner needs no button. role="status" announces
 * it without interrupting, since the data on screen is still usable.
 */
export function StaleDataBanner({ lastUpdatedAt }: { lastUpdatedAt: Timestamp | null }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="font-semibold">Couldn&apos;t refresh.</span>{' '}
      {lastUpdatedAt === null ? null : (
        <>
          Last updated at{' '}
          <time dateTime={new Date(lastUpdatedAt).toISOString()}>{formatTime(lastUpdatedAt)}</time>
          .{' '}
        </>
      )}
      Retrying automatically.
    </div>
  );
}
