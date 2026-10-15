import { describe, expect, it, vi } from 'vitest';
import { formatDateTime, formatMinutesAgo, formatTime, minutesSince } from './time';

// Dates are built from local parts so the expectations hold in any time zone.
const placedAt = new Date(2026, 9, 14, 18, 5);
const secondsLater = (seconds: number) => new Date(placedAt.getTime() + seconds * 1000);

describe('formatTime', () => {
  it.each([
    [new Date(2026, 9, 14, 18, 5), '6:05 PM'],
    [new Date(2026, 9, 14, 0, 0), '12:00 AM'],
    [new Date(2026, 9, 14, 12, 30), '12:30 PM'],
  ])('formats %s as %s with a plain space before AM/PM', (date, text) => {
    expect(formatTime(date)).toBe(text);
  });

  it('accepts ISO strings from the API and epoch milliseconds', () => {
    expect(formatTime(placedAt.toISOString())).toBe('6:05 PM');
    expect(formatTime(placedAt.getTime())).toBe('6:05 PM');
  });
});

describe('formatDateTime', () => {
  it('includes the date, for times that may not be from today', () => {
    expect(formatDateTime(placedAt)).toBe('Oct 14, 6:05 PM');
    expect(formatDateTime(placedAt.toISOString())).toBe('Oct 14, 6:05 PM');
  });
});

describe('minutesSince', () => {
  it.each([
    [0, 0],
    [59, 0],
    [60, 1],
    [119, 1],
    [45 * 60, 45],
  ])('counts %i seconds as %i whole minutes', (seconds, minutes) => {
    expect(minutesSince(placedAt, secondsLater(seconds))).toBe(minutes);
  });

  it('never goes negative when the server clock is ahead of the browser', () => {
    expect(minutesSince(placedAt, secondsLater(-90))).toBe(0);
  });
});

describe('formatMinutesAgo', () => {
  it.each([
    [0, 'Just now'],
    [59, 'Just now'],
    [60, '1 min ago'],
    [12 * 60 + 30, '12 min ago'],
    [75 * 60, '75 min ago'],
    [-30, 'Just now'],
  ])('describes an order placed %i seconds ago as "%s"', (seconds, text) => {
    expect(formatMinutesAgo(placedAt.toISOString(), secondsLater(seconds))).toBe(text);
  });

  it('measures up to the current time by default', () => {
    vi.useFakeTimers({ now: secondsLater(5 * 60) });
    try {
      expect(formatMinutesAgo(placedAt)).toBe('5 min ago');
    } finally {
      vi.useRealTimers();
    }
  });
});
