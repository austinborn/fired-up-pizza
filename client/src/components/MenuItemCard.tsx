import type { MenuItem } from '@fired-up-pizza/shared';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { formatCents } from '../lib/money';

/**
 * One pizza on the customer menu. The whole card links to the pizza's builder
 * page, /menu/:menuItemId.
 * - The link's accessible name is the pizza's name and price, e.g.
 *   "Margherita from $10.99". The description, when there is one, is the
 *   link's accessible description, so screen readers read it after the name
 *   instead of as part of it.
 * - The price is the base price, shown as "from": a small pizza (the size
 *   whose multiplier is 1) before any crust or topping extras, which the
 *   builder adds (ADR 0003 rule 2).
 * - The path holds only the server-assigned numeric id, never text that staff
 *   typed (ADR 0007 rule 9).
 */
export function MenuItemCard({ menuItem }: { menuItem: MenuItem }) {
  const id = useId();
  const nameId = `${id}-name`;
  const descriptionId = `${id}-description`;
  const priceId = `${id}-price`;
  const { name, description, basePriceCents } = menuItem;

  return (
    <Link
      to={`/menu/${menuItem.id}`}
      aria-labelledby={`${nameId} ${priceId}`}
      aria-describedby={description ? descriptionId : undefined}
      className="group flex h-full flex-col rounded-lg border border-stone-200 bg-white p-5 shadow-sm transition hover:border-orange-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
    >
      <span
        id={nameId}
        className="text-lg font-semibold text-stone-900 group-hover:text-orange-700"
      >
        {name}
      </span>
      {description ? (
        <span id={descriptionId} className="mt-1 text-sm text-stone-600">
          {description}
        </span>
      ) : null}
      <span id={priceId} className="mt-auto pt-4 text-sm text-stone-600">
        from{' '}
        <span className="text-base font-semibold text-stone-900">
          {formatCents(basePriceCents)}
        </span>
      </span>
    </Link>
  );
}
