import { apiErrorIssues, type ApiErrorIssue } from '@fired-up-pizza/shared';
import {
  MAX_ITEMS_PER_ORDER,
  MAX_ORDER_NOTES_LENGTH,
  type OrderDetails,
  type PlaceOrderRequest,
} from '@fired-up-pizza/shared/orders-api';
import { normalizePhoneNumber } from '@fired-up-pizza/shared/phone';
import { computeLineTotalCents, MAX_QUANTITY_PER_ITEM } from '@fired-up-pizza/shared/pricing';
import {
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/http';
import { placeOrder } from '../../api/orders';
import { EmptyState } from '../../components/EmptyState';
import { useCart, type CartLineItem } from '../../context/CartContext';
import { formatCents } from '../../lib/money';

/**
 * Where checkout saves the phone number of the order it placed, in E.164 form,
 * for the order tracking page to fill in.
 */
export const PHONE_STORAGE_KEY = 'fired-up-pizza.phone';

const LINK_CLASS = 'font-medium text-orange-700 hover:underline';

const INPUT_CLASS =
  'mt-1 block w-full rounded-md border bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-2 focus:outline-offset-1 focus:outline-orange-600 disabled:bg-stone-100 disabled:text-stone-500';

/** Problems with the checkout fields, each shown under its field. */
interface FieldErrors {
  phone?: string;
  notes?: string;
}

/**
 * What the server reported about cart lines, by lineId, with the selections of
 * the line it was reported for. Another tab can replace the cart and give a
 * lineId to a different pizza, so a line shows its problems only while it
 * still holds those selections (lineProblemsOf).
 */
type LineProblems = ReadonlyMap<string, { selections: string; messages: readonly string[] }>;

const NO_LINE_PROBLEMS: LineProblems = new Map();

/**
 * The cart and checkout at /cart. Payment is at the counter, so the order needs
 * only a phone number, plus notes for the kitchen if the customer has any.
 * - Each line shows its customizations and the cart's estimated prices, and its
 *   quantity can be changed or the line removed. Line totals and the total use
 *   the shared pricing formula (ADR 0003 rule 2), and they are estimates: the
 *   confirmation shows the totals the server computes (rule 5).
 * - Placing the order checks the form with the server's rules first, the phone
 *   number with @fired-up-pizza/shared/phone (ADR 0005 rule 2), and sends
 *   nothing while something is wrong. The request names catalog rows by id and
 *   never carries a price (ADR 0003 rule 3).
 * - A failed order keeps the cart. Each problem shows where it applies: a phone
 *   or notes problem under its field, an unavailable item or topping on its
 *   cart line, and anything else above the submit button.
 * - A placed order empties the cart, saves the phone number for order tracking
 *   (PHONE_STORAGE_KEY), and opens the confirmation with the order the server
 *   returned as router state.
 */
export function CartPage() {
  const { items } = useCart();
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <section className="space-y-8">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-bold tracking-tight focus:outline-none"
      >
        Your cart
      </h1>
      {items.length === 0 ? (
        <EmptyState title="Your cart is empty">
          <Link to="/" className={LINK_CLASS}>
            Browse the menu
          </Link>{' '}
          to build a pizza.
        </EmptyState>
      ) : (
        <Checkout pageHeadingRef={headingRef} />
      )}
    </section>
  );
}

/** The lines of a cart that is not empty, and the form that places them as an order. */
function Checkout({ pageHeadingRef }: { pageHeadingRef: RefObject<HTMLHeadingElement> }) {
  const { items, estimatedTotalCents, updateQuantity, removeItem, clear } = useCart();
  const navigate = useNavigate();
  const id = useId();
  const ids = {
    linesHeading: `${id}-lines-heading`,
    checkoutHeading: `${id}-checkout-heading`,
    phone: `${id}-phone`,
    notes: `${id}-notes`,
  };
  const linesHeadingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [lineProblems, setLineProblems] = useState<LineProblems>(NO_LINE_PROBLEMS);
  const [formErrors, setFormErrors] = useState<readonly string[]>([]);
  const [isPlacing, setIsPlacing] = useState(false);
  const focusProblem = useRef(false);

  // After a submit that did not place the order, moves focus once the messages
  // are on screen and the form is enabled again: to the first field with a
  // problem, so screen readers read its message with it, or else to the submit
  // button, right below the message that says what went wrong.
  useEffect(() => {
    if (!focusProblem.current) {
      return;
    }
    focusProblem.current = false;
    (
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? submitRef.current
    )?.focus();
  });

  const hasLineProblems = items.some((item) => lineProblemsOf(lineProblems, item).length > 0);

  function edit(field: keyof FieldErrors, setValue: (text: string) => void, text: string) {
    setValue(text);
    setErrors((previous) =>
      previous[field] === undefined ? previous : { ...previous, [field]: undefined },
    );
  }

  function remove(lineId: string) {
    removeItem(lineId);
    // The removed line takes its buttons with it. Keep keyboard focus nearby:
    // on the list's heading, or on the page's heading once the cart is empty.
    (items.length > 1 ? linesHeadingRef : pageHeadingRef).current?.focus();
  }

  async function submit() {
    const checked = checkCheckout(phone, notes, items.length);
    if (!checked.ok) {
      // Nothing is sent, so what the server last said about the lines stands.
      setErrors(checked.errors);
      setFormErrors(checked.formErrors);
      focusProblem.current = true;
      return;
    }
    // The lines as sent: the server's `items.<index>` paths index this list.
    const sentLines = items;
    setErrors({});
    setLineProblems(NO_LINE_PROBLEMS);
    setFormErrors([]);
    setIsPlacing(true);
    // No AbortSignal: once the request is sent, the order may be placed even if
    // the customer leaves this page, and its confirmation should still open.
    let order: OrderDetails;
    try {
      order = await placeOrder(orderRequest(phone, checked.notes, sentLines));
    } catch (error) {
      const problems = checkoutProblems(error, sentLines);
      setErrors(problems.fields);
      setLineProblems(problems.lines);
      setFormErrors(problems.form);
      setIsPlacing(false);
      focusProblem.current = true;
      return;
    }
    savePhoneNumber(checked.phoneNumber);
    // The router applies navigations as transitions (v7_startTransition).
    // Emptying the cart in the same transition renders both at once, so this
    // page never shows its empty state on the way to the confirmation.
    startTransition(() => {
      clear();
      navigate(`/order-confirmation/${order.id}`, { state: order });
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <section
        aria-labelledby={ids.linesHeading}
        className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm"
      >
        <h2
          id={ids.linesHeading}
          ref={linesHeadingRef}
          tabIndex={-1}
          className="text-lg font-semibold tracking-tight focus:outline-none"
        >
          Your pizzas
        </h2>
        {/* role="list" keeps the list semantics that Safari drops from unstyled lists. */}
        <ul
          role="list"
          aria-labelledby={ids.linesHeading}
          className="mt-3 divide-y divide-stone-200"
        >
          {items.map((line) => (
            <CartLine
              key={line.lineId}
              line={line}
              problems={lineProblemsOf(lineProblems, line)}
              disabled={isPlacing}
              onQuantityChange={(quantity) => updateQuantity(line.lineId, quantity)}
              onRemove={() => remove(line.lineId)}
            />
          ))}
        </ul>
        <div className="mt-3 border-t border-stone-300 pt-3">
          <p className="flex justify-between text-lg font-semibold">
            <span>Estimated total</span>
            <span>{formatCents(estimatedTotalCents)}</span>
          </p>
          <p className="mt-1 text-sm text-stone-600">
            Your order confirmation shows the final total.
          </p>
        </div>
        <p className="mt-4">
          <Link to="/" className={LINK_CLASS}>
            Add another pizza
          </Link>
        </p>
      </section>

      <div className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
        <h2 id={ids.checkoutHeading} className="text-lg font-semibold tracking-tight">
          Checkout
        </h2>
        <form
          ref={formRef}
          aria-labelledby={ids.checkoutHeading}
          noValidate
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={isPlacing} className="space-y-4">
            <CheckoutField
              id={ids.phone}
              label="Phone number"
              hint="We use it to find your order. US and Canadian numbers only."
              error={errors.phone}
            >
              {(describedBy) => (
                <input
                  id={ids.phone}
                  type="tel"
                  autoComplete="tel"
                  required
                  value={phone}
                  aria-invalid={errors.phone === undefined ? undefined : true}
                  aria-describedby={describedBy}
                  onChange={(event) => edit('phone', setPhone, event.target.value)}
                  className={inputClass(errors.phone)}
                />
              )}
            </CheckoutField>
            <CheckoutField
              id={ids.notes}
              label="Notes for the kitchen"
              optional
              hint={`Up to ${MAX_ORDER_NOTES_LENGTH} characters.`}
              error={errors.notes}
            >
              {(describedBy) => (
                <textarea
                  id={ids.notes}
                  rows={3}
                  value={notes}
                  aria-invalid={errors.notes === undefined ? undefined : true}
                  aria-describedby={describedBy}
                  onChange={(event) => edit('notes', setNotes, event.target.value)}
                  className={inputClass(errors.notes)}
                />
              )}
            </CheckoutField>
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-semibold">Pay at the counter.</span> There is nothing to pay
              online: you pay when you pick up your order.
            </p>
            {hasLineProblems || formErrors.length > 0 ? (
              <div
                role="alert"
                className="space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
              >
                <p className="font-semibold">Your order was not placed.</p>
                {hasLineProblems ? (
                  <p>
                    Some pizzas in your cart can&apos;t be ordered right now. Remove them to place
                    your order.
                  </p>
                ) : null}
                {formErrors.map((message, index) => (
                  <p key={index}>{message}</p>
                ))}
              </div>
            ) : null}
            <button
              ref={submitRef}
              type="submit"
              className="w-full rounded-md bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-orange-600"
            >
              {isPlacing ? 'Placing your order…' : 'Place order'}
            </button>
          </fieldset>
        </form>
      </div>
    </div>
  );
}

interface CheckoutFieldProps {
  id: string;
  label: string;
  /** Adds "(optional)" to the label. */
  optional?: boolean;
  hint: string;
  /** Shown under the control, which the caller marks invalid. */
  error: string | undefined;
  /** Renders the control, given the ids that describe it: the hint, then any error. */
  children: (describedBy: string) => ReactNode;
}

/** A labelled checkout control with its hint and, after a failed submit, its error. */
function CheckoutField({ id, label, optional = false, hint, error, children }: CheckoutFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        {/* The space sits outside the span, so the accessible name keeps it. */}
        {optional ? (
          <>
            {' '}
            <span className="font-normal text-stone-500">(optional)</span>
          </>
        ) : null}
      </label>
      {children(error === undefined ? hintId : `${hintId} ${errorId}`)}
      <p id={hintId} className="mt-1 text-xs text-stone-500">
        {hint}
      </p>
      {error === undefined ? null : (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function inputClass(error: string | undefined): string {
  return `${INPUT_CLASS} ${error === undefined ? 'border-stone-300' : 'border-red-600'}`;
}

interface CartLineProps {
  line: CartLineItem;
  /** What the server reported about this line when the order was last sent. */
  problems: readonly string[];
  /** True while the order is being placed: the cart must not change under it. */
  disabled: boolean;
  onQuantityChange: (quantity: number) => void;
  onRemove: () => void;
}

/** One cart line, priced from its estimated unit price (ADR 0003 rules 2 and 5). */
function CartLine({ line, problems, disabled, onQuantityChange, onRemove }: CartLineProps) {
  const id = useId();
  const nameId = `${id}-name`;
  const problemsId = `${id}-problems`;
  const { quantity, display } = line;
  const { menuItemName, sizeName, crustName, toppingNames, unitPriceCents } = display;
  const hasProblems = problems.length > 0;
  return (
    <li aria-labelledby={nameId} className="py-4">
      <div className="flex justify-between gap-4">
        <div>
          <p id={nameId} className="font-medium text-stone-900">
            {menuItemName}
          </p>
          <p className="text-sm text-stone-600">
            {sizeName}, {crustName}
          </p>
          {toppingNames.length === 0 ? null : (
            <p className="text-sm text-stone-600">Toppings: {toppingNames.join(', ')}</p>
          )}
          <p className="text-sm text-stone-600">{formatCents(unitPriceCents)} each</p>
        </div>
        <p className="font-medium text-stone-900">
          {formatCents(computeLineTotalCents(unitPriceCents, quantity))}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <LineQuantity
          name={menuItemName}
          quantity={quantity}
          disabled={disabled}
          onChange={onQuantityChange}
        />
        <button
          type="button"
          disabled={disabled}
          aria-describedby={hasProblems ? problemsId : undefined}
          onClick={onRemove}
          className="rounded-md px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-50 hover:text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
        >
          Remove <span className="sr-only">{menuItemName}</span>
        </button>
      </div>
      {hasProblems ? (
        <div
          id={problemsId}
          className="mt-3 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {problems.map((problem, index) => (
            <p key={index}>{problem}</p>
          ))}
          <p className="font-medium">Remove this pizza to place your order.</p>
        </div>
      ) : null}
    </li>
  );
}

interface LineQuantityProps {
  /** The line's menu item name, for the controls' accessible names. */
  name: string;
  quantity: number;
  disabled: boolean;
  /** Receives the quantity one step up or down, within 1..MAX_QUANTITY_PER_ITEM. */
  onChange: (quantity: number) => void;
}

/**
 * A line's quantity between "−" and "+" buttons, kept to
 * 1..MAX_QUANTITY_PER_ITEM (shared/src/pricing.ts).
 * - The number is an <output>, a polite live region, so screen readers read the
 *   new quantity after each press.
 * - At a limit, its button is aria-disabled rather than disabled. A disabled
 *   button would drop keyboard focus the moment it was pressed into the limit.
 */
function LineQuantity({ name, quantity, disabled, onChange }: LineQuantityProps) {
  return (
    <div className="flex items-center gap-2">
      <StepButton
        label={`Decrease quantity of ${name}`}
        atLimit={quantity <= 1}
        disabled={disabled}
        onPress={() => onChange(quantity - 1)}
      >
        −
      </StepButton>
      <output
        aria-label={`Quantity of ${name}`}
        className="min-w-8 text-center font-medium text-stone-900 tabular-nums"
      >
        {quantity}
      </output>
      <StepButton
        label={`Increase quantity of ${name}`}
        atLimit={quantity >= MAX_QUANTITY_PER_ITEM}
        disabled={disabled}
        onPress={() => onChange(quantity + 1)}
      >
        +
      </StepButton>
    </div>
  );
}

interface StepButtonProps {
  /** The accessible name; the symbol inside is hidden from screen readers. */
  label: string;
  /** True when pressing would leave the range: the button then does nothing. */
  atLimit: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}

function StepButton({ label, atLimit, disabled, onPress, children }: StepButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-disabled={atLimit}
      disabled={disabled}
      onClick={() => {
        if (!atLimit) {
          onPress();
        }
      }}
      className="flex size-9 items-center justify-center rounded-md border border-stone-300 bg-white text-lg font-semibold text-stone-700 shadow-sm hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-white"
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

type CheckedCheckout =
  | { ok: true; phoneNumber: string; notes: string }
  | { ok: false; errors: FieldErrors; formErrors: string[] };

/**
 * Checks the form with the rules the server applies, so that nothing is sent
 * while something is wrong: the shared phone rules (ADR 0005 rule 3), the notes
 * limit after trimming, and the most lines an order can have. On success,
 * returns the phone number in E.164 form and the trimmed notes.
 */
function checkCheckout(phone: string, notes: string, lineCount: number): CheckedCheckout {
  const errors: FieldErrors = {};
  const phoneNumber = normalizePhoneNumber(phone);
  if (phoneNumber === null) {
    errors.phone =
      phone.trim() === ''
        ? 'Enter your phone number.'
        : 'Enter a 10-digit US or Canadian phone number.';
  }
  const trimmedNotes = notes.trim();
  if (trimmedNotes.length > MAX_ORDER_NOTES_LENGTH) {
    errors.notes = `Notes can be at most ${MAX_ORDER_NOTES_LENGTH} characters. These are ${trimmedNotes.length}.`;
  }
  const formErrors =
    lineCount > MAX_ITEMS_PER_ORDER
      ? [
          `An order can have at most ${MAX_ITEMS_PER_ORDER} different pizzas. Remove some to place your order.`,
        ]
      : [];
  if (phoneNumber === null || errors.notes !== undefined || formErrors.length > 0) {
    return { ok: false, errors, formErrors };
  }
  return { ok: true, phoneNumber, notes: trimmedNotes };
}

/**
 * The POST /api/orders body. Each line is sent as catalog ids and a quantity,
 * never with its estimated price (ADR 0003 rule 3). The phone number goes as
 * the customer typed it, for the server to check and normalize (ADR 0005), and
 * notes are left out when there are none.
 */
function orderRequest(
  typedPhone: string,
  notes: string,
  lines: readonly CartLineItem[],
): PlaceOrderRequest {
  return {
    phoneNumber: typedPhone,
    ...(notes === '' ? {} : { notes }),
    items: lines.map(({ menuItemId, sizeId, crustId, toppingIds, quantity }) => ({
      menuItemId,
      sizeId,
      crustId,
      toppingIds: [...toppingIds],
      quantity,
    })),
  };
}

interface CheckoutProblems {
  fields: FieldErrors;
  lines: LineProblems;
  /** What no field or line explains, shown above the submit button. */
  form: string[];
}

/** Matches an issue path into a request line, e.g. `items.0.toppingIds.1`. */
const LINE_ISSUE_PATH = /^items\.(\d+)(?:\.(.+))?$/;

/**
 * Where to show what a failed POST /api/orders reports.
 * - INVALID_PHONE_NUMBER goes under the phone field.
 * - The `details.issues` of a VALIDATION_ERROR or ITEM_UNAVAILABLE go under
 *   the field, or on the cart line, that their path names. An unavailable menu
 *   item, size, crust, or topping is named the way the cart shows it.
 * - Anything else, such as an issue for the request as a whole or a failure
 *   with no issues (offline, a server error), goes above the submit button.
 */
function checkoutProblems(error: unknown, sentLines: readonly CartLineItem[]): CheckoutProblems {
  const fields: FieldErrors = {};
  const lines = new Map<string, { selections: string; messages: string[] }>();
  if (error instanceof ApiError && error.code === 'INVALID_PHONE_NUMBER') {
    fields.phone = error.message;
    return { fields, lines, form: [] };
  }
  const issues =
    error instanceof ApiError &&
    (error.code === 'VALIDATION_ERROR' || error.code === 'ITEM_UNAVAILABLE')
      ? apiErrorIssues(error.details)
      : [];
  const unavailable = error instanceof ApiError && error.code === 'ITEM_UNAVAILABLE';
  const form: string[] = [];
  for (const issue of issues) {
    if (issue.path === 'phoneNumber') {
      fields.phone ??= issue.message;
    } else if (issue.path === 'notes') {
      fields.notes ??= issue.message;
    } else {
      const problem = lineProblem(issue, sentLines, unavailable);
      if (problem === undefined) {
        form.push(issue.message);
      } else {
        const { line, message } = problem;
        const reported = lines.get(line.lineId);
        if (reported === undefined) {
          lines.set(line.lineId, { selections: selectionsOf(line), messages: [message] });
        } else {
          reported.messages.push(message);
        }
      }
    }
  }
  return { fields, lines, form: issues.length === 0 ? [errorMessage(error)] : form };
}

/** The line an issue's path points into, with the message to show on it. */
function lineProblem(
  issue: ApiErrorIssue,
  sentLines: readonly CartLineItem[],
  unavailable: boolean,
): { line: CartLineItem; message: string } | undefined {
  const match = LINE_ISSUE_PATH.exec(issue.path);
  const line = match === null ? undefined : sentLines[Number(match[1])];
  if (match === null || line === undefined) {
    return undefined;
  }
  const name = unavailable ? unavailableName(line, match[2]) : undefined;
  return {
    line,
    message: name === undefined ? issue.message : `${name} is not available right now.`,
  };
}

/**
 * The cart's name for what an ITEM_UNAVAILABLE issue's field points at, e.g.
 * "Mushrooms" for `toppingIds.1` on a line whose second topping is Mushrooms.
 */
function unavailableName({ display }: CartLineItem, field: string | undefined): string | undefined {
  switch (field) {
    case 'menuItemId':
      return display.menuItemName;
    case 'sizeId':
      return display.sizeName;
    case 'crustId':
      return display.crustName;
  }
  const topping = /^toppingIds\.(\d+)$/.exec(field ?? '');
  return topping === null ? undefined : display.toppingNames[Number(topping[1])];
}

/** The problems reported for a line, while it still holds the selections they were reported for. */
function lineProblemsOf(problems: LineProblems, line: CartLineItem): readonly string[] {
  const reported = problems.get(line.lineId);
  return reported?.selections === selectionsOf(line) ? reported.messages : [];
}

/** A line's menu item, size, crust, and toppings, as one comparable string. */
function selectionsOf({ menuItemId, sizeId, crustId, toppingIds }: CartLineItem): string {
  return JSON.stringify([menuItemId, sizeId, crustId, toppingIds]);
}

/**
 * Saves the phone number for order tracking. Storage that is blocked or full
 * is skipped: the order is placed either way, and tracking then asks for the
 * number.
 */
function savePhoneNumber(phoneNumber: string): void {
  try {
    window.localStorage.setItem(PHONE_STORAGE_KEY, phoneNumber);
  } catch {
    // Nothing to fall back to; tracking starts with an empty phone field.
  }
}
