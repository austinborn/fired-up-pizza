// Money is integer cents everywhere; dollars exist only on screen (ADR 0003 rule 1).

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Formats integer cents for display: formatCents(1374) is "$13.74". */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/**
 * Formats integer cents as plain dollars for a price input, with no "$" or
 * thousands separator: formatCentsForInput(1299) is "12.99", and
 * formatCentsForInput(100000) is "1000.00". parseDollarsToCents reads the
 * text back to the same cents.
 */
export function formatCentsForInput(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const whole = Math.abs(cents);
  return `${sign}${Math.trunc(whole / 100)}.${String(whole % 100).padStart(2, '0')}`;
}

// Dollars, then up to two digits of cents. The lookahead makes the amount
// start with a digit, or with a point and a digit, so "", "$", and "." do
// not match.
const DOLLARS = /^\$?\s*(?=\.?\d)(\d*)(?:\.(\d{0,2}))?$/;

/**
 * Reads a dollar amount that staff typed, such as "12.99", "10", ".5", or
 * "$10.50", as integer cents. It works on the text, never with float math:
 * the dollars digits and the cents digits, padded to two, are joined and read
 * as one whole number, so "4.35" is exactly 435 (parseFloat("4.35") * 100 is
 * 434.99999999999994).
 *
 * Spaces around the amount and a leading "$" are allowed. Anything else is
 * null: an empty or blank string, a negative amount, more than two decimal
 * places, a thousands separator, an exponent, or any other text. So is an
 * amount too large to count in cents exactly.
 */
export function parseDollarsToCents(text: string): number | null {
  const match = DOLLARS.exec(text.trim());
  if (match === null) {
    return null;
  }
  const [, dollars = '', cents = ''] = match;
  const total = Number(`${dollars}${cents.padEnd(2, '0')}`);
  return Number.isSafeInteger(total) ? total : null;
}
