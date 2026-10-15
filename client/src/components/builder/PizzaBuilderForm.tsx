import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import {
  computeLineTotalCents,
  computeUnitPriceCents,
  MAX_TOPPINGS_PER_ITEM,
} from '@fired-up-pizza/shared/pricing';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../../context/CartContext';
import { formatCents } from '../../lib/money';
import { QuantityStepper } from './QuantityStepper';

/** A list with at least one entry. */
export type NonEmptyList<T> = readonly [T, ...T[]];

export interface PizzaBuilderFormProps {
  menuItem: MenuItem;
  /** In the order GET /api/sizes sends them, smallest price multiplier first. */
  sizes: NonEmptyList<Size>;
  /** In the order GET /api/crusts sends them, cheapest first. */
  crusts: NonEmptyList<Crust>;
  /** The available toppings, in the order GET /api/toppings sends them. */
  toppings: readonly Topping[];
}

/**
 * Customizes one pizza and adds it to the cart.
 * - Size and crust are required single choices. They start on the first size
 *   and crust, which the API lists cheapest first, so the builder opens at the
 *   pizza's lowest price.
 * - Up to MAX_TOPPINGS_PER_ITEM toppings. At the limit, the unchosen ones are
 *   disabled until one is removed.
 * - Each size's price, the price each, and the total come from the shared
 *   pricing formula (ADR 0003 rule 2). Crusts and toppings show their catalog
 *   prices as extras. All of these are estimates: the server prices the order
 *   again from the catalog (ADR 0003 rule 5).
 * - "Add to cart" hands the chosen catalog rows to the cart, which stores
 *   their ids and a display snapshot, and then opens the cart.
 *
 * The page keys this form by menu item, so its choices start over when the
 * route moves to another pizza.
 */
export function PizzaBuilderForm({ menuItem, sizes, crusts, toppings }: PizzaBuilderFormProps) {
  const { addItem } = useCart();
  const navigate = useNavigate();
  const id = useId();
  const [size, setSize] = useState<Size>(sizes[0]);
  const [crust, setCrust] = useState<Crust>(crusts[0]);
  const [toppingIds, setToppingIds] = useState<ReadonlySet<number>>(() => new Set());
  const [quantity, setQuantity] = useState(1);

  // Chosen toppings keep the catalog's order, whatever order they were picked in.
  const chosenToppings = toppings.filter((topping) => toppingIds.has(topping.id));
  const atToppingLimit = chosenToppings.length >= MAX_TOPPINGS_PER_ITEM;
  const unitPriceCents = computeUnitPriceCents({
    basePriceCents: menuItem.basePriceCents,
    sizeMultiplier: size.priceMultiplier,
    crustDeltaCents: crust.priceDeltaCents,
    toppingPricesCents: chosenToppings.map((topping) => topping.priceCents),
  });
  const lineTotalCents = computeLineTotalCents(unitPriceCents, quantity);

  function toggleTopping(toppingId: number, chosen: boolean) {
    setToppingIds((current) => {
      const next = new Set(current);
      if (chosen) {
        next.add(toppingId);
      } else {
        next.delete(toppingId);
      }
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addItem({ menuItem, size, crust, toppings: chosenToppings, quantity });
    // A fixed path: nothing a user typed ever reaches navigate() (ADR 0007 rule 9).
    navigate('/cart');
  }

  const summaryHeadingId = `${id}-summary`;
  const toppingHintId = `${id}-topping-hint`;

  return (
    <form onSubmit={handleSubmit} className="grid gap-8 lg:grid-cols-3 lg:items-start">
      <div className="space-y-8 lg:col-span-2">
        <OptionGroup legend="Size">
          <div className="grid gap-3 sm:grid-cols-3">
            {sizes.map((option) => (
              <OptionLabel
                key={option.id}
                name={option.name}
                price={formatCents(plainPriceCents(menuItem, option))}
              >
                <input
                  type="radio"
                  name={`${id}-size`}
                  value={option.id}
                  checked={option.id === size.id}
                  onChange={() => setSize(option)}
                  className={controlClass}
                />
              </OptionLabel>
            ))}
          </div>
        </OptionGroup>

        <OptionGroup legend="Crust">
          <div className="grid gap-3 sm:grid-cols-2">
            {crusts.map((option) => (
              <OptionLabel
                key={option.id}
                name={option.name}
                price={option.priceDeltaCents > 0 ? extraPrice(option.priceDeltaCents) : undefined}
              >
                <input
                  type="radio"
                  name={`${id}-crust`}
                  value={option.id}
                  checked={option.id === crust.id}
                  onChange={() => setCrust(option)}
                  className={controlClass}
                />
              </OptionLabel>
            ))}
          </div>
        </OptionGroup>

        {toppings.length === 0 ? (
          <OptionGroup legend="Toppings">
            <p className="text-sm text-stone-600">No toppings are available right now.</p>
          </OptionGroup>
        ) : (
          <OptionGroup legend="Toppings" describedBy={toppingHintId}>
            <p id={toppingHintId} aria-live="polite" className="text-sm text-stone-600">
              {atToppingLimit
                ? `You've chosen ${MAX_TOPPINGS_PER_ITEM} toppings, the most one pizza can have.`
                : `Choose up to ${MAX_TOPPINGS_PER_ITEM}.`}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {toppings.map((topping) => {
                const chosen = toppingIds.has(topping.id);
                return (
                  <OptionLabel
                    key={topping.id}
                    name={topping.name}
                    price={extraPrice(topping.priceCents)}
                  >
                    <input
                      type="checkbox"
                      checked={chosen}
                      disabled={atToppingLimit && !chosen}
                      onChange={(event) => toggleTopping(topping.id, event.target.checked)}
                      className={controlClass}
                    />
                  </OptionLabel>
                );
              })}
            </div>
          </OptionGroup>
        )}
      </div>

      <section
        aria-labelledby={summaryHeadingId}
        className="space-y-5 rounded-lg border border-stone-200 bg-white p-5 shadow-sm lg:sticky lg:top-6"
      >
        <h2 id={summaryHeadingId} className="text-lg font-semibold text-stone-900">
          Your pizza
        </h2>
        <QuantityStepper quantity={quantity} onChange={setQuantity} />
        {/* Announces each new price as a whole, so it is never read without its label. */}
        <dl aria-live="polite" aria-atomic="true" className="space-y-1">
          <div className="flex items-baseline justify-between gap-4 text-sm text-stone-600">
            <dt>Price each</dt> <dd>{formatCents(unitPriceCents)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 text-lg font-semibold text-stone-900">
            <dt>Total</dt> <dd>{formatCents(lineTotalCents)}</dd>
          </div>
        </dl>
        <button
          type="submit"
          className="w-full rounded-md bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
        >
          Add to cart
        </button>
        <p className="text-xs text-stone-500">
          Final prices are confirmed when you place your order.
        </p>
      </section>
    </form>
  );
}

const controlClass =
  'size-4 shrink-0 accent-orange-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600';

interface OptionGroupProps {
  legend: string;
  /** The id of a hint inside the group, which becomes the group's description. */
  describedBy?: string;
  children: ReactNode;
}

/** A labelled group of choices: a fieldset, which screen readers announce with its legend. */
function OptionGroup({ legend, describedBy, children }: OptionGroupProps) {
  return (
    <fieldset aria-describedby={describedBy}>
      <legend className="text-lg font-semibold text-stone-900">{legend}</legend>
      <div className="mt-3">{children}</div>
    </fieldset>
  );
}

interface OptionLabelProps {
  name: string;
  /** Shown after the name, and part of the control's accessible name. */
  price: string | undefined;
  /** The radio button or checkbox that the label names. */
  children: ReactNode;
}

/** One choice: the whole card is the control's label, so clicking anywhere on it chooses it. */
function OptionLabel({ name, price, children }: OptionLabelProps) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-md border border-stone-300 bg-white px-4 py-3 text-sm shadow-sm transition-colors hover:border-orange-300 has-checked:border-orange-500 has-checked:bg-orange-50 has-disabled:cursor-not-allowed has-disabled:opacity-50 has-disabled:hover:border-stone-300">
      {children}
      <span className="flex-1 font-medium text-stone-900">{name}</span>
      {price === undefined ? null : (
        <>
          {' '}
          <span className="text-stone-600">{price}</span>
        </>
      )}
    </label>
  );
}

/**
 * The pizza in `size` before crust and toppings, by the shared formula. With
 * the crust's and toppings' extras added, it makes up the price each.
 */
function plainPriceCents(menuItem: MenuItem, size: Size): number {
  return computeUnitPriceCents({
    basePriceCents: menuItem.basePriceCents,
    sizeMultiplier: size.priceMultiplier,
    crustDeltaCents: 0,
    toppingPricesCents: [],
  });
}

/** What a crust or topping adds to the price each, e.g. "+$2.00". */
function extraPrice(cents: number): string {
  return `+${formatCents(cents)}`;
}
