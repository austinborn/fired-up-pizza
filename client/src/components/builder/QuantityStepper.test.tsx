import { MAX_QUANTITY_PER_ITEM } from '@fired-up-pizza/shared/pricing';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/render';
import { QuantityStepper } from './QuantityStepper';

/** The stepper with its quantity in state, as the builder form keeps it, and that quantity on show. */
function Stepper({ initial = 1 }: { initial?: number }) {
  const [quantity, setQuantity] = useState(initial);
  return (
    <>
      <QuantityStepper quantity={quantity} onChange={setQuantity} />
      <p>Chosen: {quantity}</p>
    </>
  );
}

function field(): HTMLElement {
  return screen.getByRole('spinbutton', { name: 'Quantity' });
}

function decrease(): HTMLElement {
  return screen.getByRole('button', { name: 'Decrease quantity' });
}

function increase(): HTMLElement {
  return screen.getByRole('button', { name: 'Increase quantity' });
}

function expectChosen(quantity: number) {
  expect(screen.getByText(/^Chosen:/)).toHaveTextContent(`Chosen: ${quantity}`);
}

describe('QuantityStepper', () => {
  it('is a labelled number field between labelled step buttons', () => {
    renderWithProviders(<Stepper initial={3} />);

    expect(field()).toHaveValue(3);
    expect(field()).toHaveAttribute('min', '1');
    expect(field()).toHaveAttribute('max', String(MAX_QUANTITY_PER_ITEM));
    expect(field()).toHaveAccessibleDescription(`Up to ${MAX_QUANTITY_PER_ITEM} at a time.`);
    expect(decrease()).toHaveAttribute('aria-disabled', 'false');
    expect(increase()).toHaveAttribute('aria-disabled', 'false');
  });

  it('steps up and down with its buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={3} />);

    await user.click(increase());
    await user.click(increase());
    expect(field()).toHaveValue(5);
    expectChosen(5);

    await user.click(decrease());
    expect(field()).toHaveValue(4);
    expectChosen(4);
  });

  it('does not go below 1', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={2} />);

    await user.click(decrease());
    expect(decrease()).toHaveAttribute('aria-disabled', 'true');

    await user.click(decrease());
    expect(field()).toHaveValue(1);
    expectChosen(1);
  });

  it(`does not go above ${MAX_QUANTITY_PER_ITEM}, and the button stays focusable at the limit`, async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={MAX_QUANTITY_PER_ITEM - 1} />);

    await user.click(field());
    await user.tab();
    expect(increase()).toHaveFocus();
    await user.keyboard('{Enter}');
    expectChosen(MAX_QUANTITY_PER_ITEM);

    // aria-disabled, not disabled: a disabled button would drop the focus.
    expect(increase()).toHaveAttribute('aria-disabled', 'true');
    expect(increase()).toBeEnabled();
    expect(increase()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(field()).toHaveValue(MAX_QUANTITY_PER_ITEM);
    expectChosen(MAX_QUANTITY_PER_ITEM);
  });

  it('takes a typed quantity at once', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper />);

    await user.clear(field());
    await user.type(field(), '12');

    expect(field()).toHaveValue(12);
    expectChosen(12);
  });

  it(`turns a typed quantity above ${MAX_QUANTITY_PER_ITEM} into ${MAX_QUANTITY_PER_ITEM}`, async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper />);

    await user.clear(field());
    await user.type(field(), '25');

    expect(field()).toHaveValue(MAX_QUANTITY_PER_ITEM);
    expectChosen(MAX_QUANTITY_PER_ITEM);
  });

  it('reads a typed leading zero as part of the number', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={3} />);

    await user.clear(field());
    await user.type(field(), '0');
    expect(field()).toHaveValue(0);
    expectChosen(3);

    await user.type(field(), '5');
    expect(field()).toHaveValue(5);
    expectChosen(5);
  });

  it('keeps the quantity while the field is empty, and shows it again when the field loses focus', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={3} />);

    await user.clear(field());
    expect(field()).toHaveValue(null);
    expectChosen(3);

    await user.tab();
    expect(field()).toHaveValue(3);
  });

  it('keeps the quantity for a typed number that is not whole', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={3} />);

    await user.clear(field());
    await user.type(field(), '2.5');
    expect(field()).toHaveValue(2.5);
    expectChosen(2);

    await user.tab();
    expect(field()).toHaveValue(2);
  });

  it('steps from the quantity, not from what is typed, after the field is emptied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={3} />);

    await user.clear(field());
    await user.click(increase());

    expect(field()).toHaveValue(4);
    expectChosen(4);
  });

  it('shows the stepped quantity when a button is clicked without the field losing focus', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Stepper initial={3} />);

    await user.clear(field());
    // Assistive technology can click a button without moving the focus.
    fireEvent.click(increase());

    expect(field()).toHaveFocus();
    expect(field()).toHaveValue(4);
    expectChosen(4);
  });
});
