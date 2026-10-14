/** Shared NavLink styling for the customer and staff headers. */
export function navLinkClass({ isActive }: { isActive: boolean }): string {
  const base = 'rounded-md px-3 py-2 text-sm font-medium transition-colors';
  return isActive
    ? `${base} bg-orange-100 text-orange-900`
    : `${base} text-stone-700 hover:bg-stone-100 hover:text-stone-900`;
}
