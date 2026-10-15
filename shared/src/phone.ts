// Phone-number rules for the MVP customer identity (ADR 0005 rule 3). They live
// in shared so client forms accept exactly what the server accepts. Only this
// file and server/src/identity/ parse phone numbers (ADR 0005 rule 2).
//
// Accepted: North American Numbering Plan numbers written as 10 digits, with an
// optional leading 1 or +1 and any spaces, hyphens, periods, or parentheses.
// The area code and the exchange code (the two groups of three) must start with
// 2-9. Everything else is rejected: letters, extensions, other country codes,
// and wrong digit counts. Accepted numbers are stored and compared in E.164
// form, `+1XXXXXXXXXX`.
//
// The usual placeholder 555-123-4567 is rejected because its exchange code
// starts with 1. Tests should use the fictional 555-01XX range, e.g. 212-555-0142.

/** Spaces and the punctuation people type in phone numbers; dropped before matching. */
const SEPARATORS = /[\s().-]/g;

/** An optional 1 or +1, then NXX-NXX-XXXX where N is 2-9 (captured without the prefix). */
const ACCEPTED_NUMBER = /^(?:\+?1)?([2-9]\d{2}[2-9]\d{6})$/;

/** Returns the E.164 form (`+1XXXXXXXXXX`) of an accepted phone number, or null. */
export function normalizePhoneNumber(input: string): string | null {
  const compact = input.replace(SEPARATORS, '');
  return ACCEPTED_NUMBER.test(compact) ? compact.replace(ACCEPTED_NUMBER, '+1$1') : null;
}

/**
 * Formats an E.164 number, as returned by normalizePhoneNumber or the API, for
 * display: `+15551234567` becomes `(555) 123-4567`. This is formatting, not
 * validation. Any other input is returned unchanged, so a display never drops
 * what it was given.
 */
export function formatPhoneNumber(phoneNumber: string): string {
  return phoneNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3');
}
