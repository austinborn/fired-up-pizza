import type { MenuFieldsProps, MenuItemValues, ToppingValues } from './menu-catalog';

interface MenuFieldProps {
  id: string;
  label: string;
  value: string;
  /** Shown under the input, which is then marked invalid and described by it. */
  error: string | undefined;
  onChange: (text: string) => void;
  /** Text, a multi-line description, or a price typed in dollars after a "$". */
  kind?: 'text' | 'multiline' | 'price';
  /** Adds "(optional)" to the label. Every other field is marked required. */
  optional?: boolean;
  className?: string;
}

/**
 * One labelled input of a staff menu form. The form validates on submit, so
 * there is no maxLength: a pasted name that is too long is reported, not
 * silently cut short.
 */
export function MenuField({
  id,
  label,
  value,
  error,
  onChange,
  kind = 'text',
  optional = false,
  className,
}: MenuFieldProps) {
  const errorId = `${id}-error`;
  const invalid = error !== undefined;
  const control = {
    id,
    value,
    required: !optional,
    'aria-invalid': invalid ? true : undefined,
    'aria-describedby': invalid ? errorId : undefined,
    className: [
      'block w-full rounded-md border bg-white py-2 pr-3 text-sm text-stone-900 shadow-sm focus:outline-2 focus:outline-offset-1 focus:outline-orange-600 disabled:bg-stone-100 disabled:text-stone-500',
      invalid ? 'border-red-600' : 'border-stone-300',
      // Room for the "$" in front of a price.
      kind === 'price' ? 'pl-7' : 'pl-3',
    ].join(' '),
  };

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
        {optional ? <span className="font-normal text-stone-500"> (optional)</span> : null}
      </label>
      <div className="relative mt-1">
        {kind === 'multiline' ? (
          <textarea {...control} rows={3} onChange={(event) => onChange(event.target.value)} />
        ) : (
          <input
            {...control}
            type="text"
            inputMode={kind === 'price' ? 'decimal' : undefined}
            autoComplete="off"
            onChange={(event) => onChange(event.target.value)}
          />
        )}
        {kind === 'price' ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-stone-500"
          >
            $
          </span>
        ) : null}
      </div>
      {invalid ? (
        <p id={errorId} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Name, category, price, and description: the fields of a menu item form. */
export function MenuItemFields({
  idPrefix,
  draft,
  errors,
  onChange,
}: MenuFieldsProps<MenuItemValues>) {
  return (
    <div className="grid gap-4 @lg:grid-cols-2">
      <MenuField
        id={`${idPrefix}-name`}
        label="Name"
        value={draft.name}
        error={errors.name}
        onChange={(text) => onChange('name', text)}
      />
      <MenuField
        id={`${idPrefix}-category`}
        label="Category"
        value={draft.category}
        error={errors.category}
        onChange={(text) => onChange('category', text)}
      />
      <MenuField
        id={`${idPrefix}-price`}
        label="Price"
        kind="price"
        value={draft.basePriceCents}
        error={errors.basePriceCents}
        onChange={(text) => onChange('basePriceCents', text)}
      />
      <MenuField
        id={`${idPrefix}-description`}
        label="Description"
        kind="multiline"
        optional
        className="@lg:col-span-2"
        value={draft.description}
        error={errors.description}
        onChange={(text) => onChange('description', text)}
      />
    </div>
  );
}

/** Name and price: the fields of a topping form. */
export function MenuToppingFields({
  idPrefix,
  draft,
  errors,
  onChange,
}: MenuFieldsProps<ToppingValues>) {
  return (
    <div className="grid gap-4 @lg:grid-cols-2">
      <MenuField
        id={`${idPrefix}-name`}
        label="Name"
        value={draft.name}
        error={errors.name}
        onChange={(text) => onChange('name', text)}
      />
      <MenuField
        id={`${idPrefix}-price`}
        label="Price"
        kind="price"
        value={draft.priceCents}
        error={errors.priceCents}
        onChange={(text) => onChange('priceCents', text)}
      />
    </div>
  );
}
