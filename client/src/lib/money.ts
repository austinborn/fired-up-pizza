// Money is integer cents everywhere; dollars exist only on screen (ADR 0003 rule 1).

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Formats integer cents for display: formatCents(1374) is "$13.74". */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}
