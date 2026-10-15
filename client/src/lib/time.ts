// Display helpers for timestamps. The API sends ISO-8601 UTC strings (ADR 0006
// rule 6); these show them in the viewer's local time.

/** A Date, an ISO-8601 string from the API, or epoch milliseconds. */
export type Timestamp = Date | string | number;

const timeOfDay = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
const dateAndTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** The local time of day, e.g. "6:05 PM". */
export function formatTime(value: Timestamp): string {
  return plainSpaces(timeOfDay.format(new Date(value)));
}

/** The local date and time, e.g. "Oct 14, 6:05 PM", for anything that may not be from today. */
export function formatDateTime(value: Timestamp): string {
  return plainSpaces(dateAndTime.format(new Date(value)));
}

/**
 * Whole minutes from `value` to `now`. Never negative: the server's clock can
 * run slightly ahead of the browser's.
 */
export function minutesSince(value: Timestamp, now: Timestamp = Date.now()): number {
  const elapsedMs = new Date(now).getTime() - new Date(value).getTime();
  return Math.max(0, Math.floor(elapsedMs / 60_000));
}

/** An order's age: "Just now" for under a minute, then "N min ago". */
export function formatMinutesAgo(value: Timestamp, now: Timestamp = Date.now()): string {
  const minutes = minutesSince(value, now);
  return minutes === 0 ? 'Just now' : `${minutes} min ago`;
}

// Some ICU versions put a narrow no-break space before AM/PM. Use plain spaces
// so the output is the same on every supported Node version and browser.
function plainSpaces(text: string): string {
  return text.replace(/\s/g, ' ');
}
