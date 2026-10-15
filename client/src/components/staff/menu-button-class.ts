// Button styles for the staff menu page's forms and rows (Tailwind only, ADR 0007 rule 6).

const BASE =
  'rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

/** The action a form is for: "Add menu item", "Save changes". */
export const MENU_PRIMARY_BUTTON = `${BASE} bg-orange-600 text-white hover:bg-orange-700 focus-visible:outline-orange-600 disabled:hover:bg-orange-600`;

/** Everything else: "Cancel", "Edit", "Hide", "Show". */
export const MENU_SECONDARY_BUTTON = `${BASE} border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 focus-visible:outline-stone-600 disabled:hover:bg-white`;
