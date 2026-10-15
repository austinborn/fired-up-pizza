import { MAX_QUANTITY_PER_ITEM } from '@fired-up-pizza/shared/pricing';
import { useId, useState, type ReactNode } from 'react';

interface QuantityStepperProps {
  /** A whole number from 1 to MAX_QUANTITY_PER_ITEM. */
  quantity: number;
  /** Receives a whole number from 1 to MAX_QUANTITY_PER_ITEM. */
  onChange: (quantity: number) => void;
}

/**
 * How many of one pizza to add: a number field between "−" and "+" buttons,
 * kept to 1..MAX_QUANTITY_PER_ITEM (shared/src/pricing.ts).
 * - The field is a native number input. Keyboard users can type a number or
 *   step with the arrow keys, and screen readers announce a spin button.
 * - A typed whole number from 1 up takes effect at once, capped at the
 *   maximum, so "25" becomes 20. Anything else, such as an emptied field or a
 *   0, stays while the customer types and gives way to the current quantity
 *   when the field loses focus. A 0 is not raised to 1, or "05" would be 15.
 * - At a limit, its button is aria-disabled rather than disabled. A disabled
 *   button would drop keyboard focus the moment it was pressed into the limit.
 */
export function QuantityStepper({ quantity, onChange }: QuantityStepperProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  // The field's text while it is not a quantity yet; null shows `quantity`.
  const [draft, setDraft] = useState<string | null>(null);

  function step(by: number) {
    // Assistive technology can click a button while the field keeps the focus,
    // so the draft goes here too, not only on blur.
    setDraft(null);
    onChange(quantity + by);
  }

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        Quantity
      </label>
      <div className="mt-1 flex items-center gap-2">
        <StepButton label="Decrease quantity" atLimit={quantity <= 1} onPress={() => step(-1)}>
          −
        </StepButton>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QUANTITY_PER_ITEM}
          step={1}
          required
          value={draft ?? String(quantity)}
          aria-describedby={hintId}
          onChange={(event) => {
            const text = event.target.value;
            const typed = /^\d+$/.test(text) ? Number(text) : 0;
            if (typed >= 1) {
              setDraft(null);
              onChange(Math.min(typed, MAX_QUANTITY_PER_ITEM));
            } else {
              setDraft(text);
            }
          }}
          onBlur={() => setDraft(null)}
          className="h-10 w-16 rounded-md border border-stone-300 bg-white px-2 text-center text-sm text-stone-900 shadow-sm focus:outline-2 focus:outline-offset-1 focus:outline-orange-600"
        />
        <StepButton
          label="Increase quantity"
          atLimit={quantity >= MAX_QUANTITY_PER_ITEM}
          onPress={() => step(1)}
        >
          +
        </StepButton>
      </div>
      <p id={hintId} className="mt-1 text-xs text-stone-500">
        Up to {MAX_QUANTITY_PER_ITEM} at a time.
      </p>
    </div>
  );
}

interface StepButtonProps {
  /** The accessible name; the symbol inside is hidden from screen readers. */
  label: string;
  /** True when pressing would leave the range: the button then does nothing. */
  atLimit: boolean;
  onPress: () => void;
  children: ReactNode;
}

function StepButton({ label, atLimit, onPress, children }: StepButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={atLimit}
      onClick={() => {
        if (!atLimit) {
          onPress();
        }
      }}
      className="flex size-10 items-center justify-center rounded-md border border-stone-300 bg-white text-lg font-semibold text-stone-700 shadow-sm hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-white"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
