import type { MenuItem, Topping } from '@fired-up-pizza/shared';
import {
  MAX_CATALOG_NAME_LENGTH,
  MAX_CATALOG_PRICE_CENTS,
  MAX_MENU_ITEM_CATEGORY_LENGTH,
  MAX_MENU_ITEM_DESCRIPTION_LENGTH,
} from '@fired-up-pizza/shared/staff-catalog-api';
import type { ComponentType } from 'react';
import { ApiError, type RequestOptions } from '../../api/http';
import { formatCents, parseDollarsToCents } from '../../lib/money';

// The staff menu page manages two catalogs, menu items and toppings, in the
// same way: a list with hidden rows marked, a create form, an inline editor,
// and a hide/show toggle. MenuCatalogSection does all of that for any
// catalog described by a MenuCatalog. This module holds that description and
// the form rules, which mirror the server's (server/src/routes/staff/catalog.ts)
// so staff see a problem before anything is sent.

/** What the page needs of every row: menu items and toppings both have it. */
export type CatalogRow = Pick<MenuItem | Topping, 'id' | 'name' | 'available'>;

/** The menu item fields the forms edit. Availability has its own toggle. */
export type MenuItemValues = Pick<MenuItem, 'name' | 'description' | 'category' | 'basePriceCents'>;

/** The topping fields the forms edit. Availability has its own toggle. */
export type ToppingValues = Pick<Topping, 'name' | 'priceCents'>;

/** A form's text, keyed like the request fields it becomes. Prices hold the dollars as typed. */
export type Draft<Values> = Record<keyof Values, string>;

/** Messages to show next to fields, keyed like the request fields. */
export type FieldErrors<Values> = Partial<Record<keyof Values, string>>;

/** A draft read with the server's rules: request values, or what is wrong with which field. */
export type ParsedDraft<Values> =
  { ok: true; values: Values } | { ok: false; errors: FieldErrors<Values> };

export interface MenuFieldsProps<Values> {
  /** Unique per form, so two forms on the page never share input ids. */
  idPrefix: string;
  draft: Draft<Values>;
  errors: FieldErrors<Values>;
  onChange: (field: keyof Values, text: string) => void;
}

/** Everything MenuCatalogSection needs to manage one catalog. */
export interface MenuCatalog<Row extends CatalogRow, Values extends object> {
  /** The section heading, e.g. "Menu items". */
  title: string;
  /** One row, as it reads in a sentence, e.g. "menu item". */
  noun: string;
  /** What the section is for, shown under its heading. */
  description: string;
  /** Loads every row, hidden ones included. */
  list: (options: RequestOptions) => Promise<Row[]>;
  create: (values: Values) => Promise<Row>;
  /** Changes some of a row's fields, keeping the rest, and resolves with the whole row. */
  update: (id: number, changes: Partial<Values>) => Promise<Row>;
  /** Hides a row from customers, or shows it again, and resolves with the whole row. */
  setAvailable: (id: number, available: boolean) => Promise<Row>;
  /** The create form's starting text. */
  emptyDraft: Draft<Values>;
  /** An edit form's starting text: the row's current values. */
  draftOf: (row: Row) => Draft<Values>;
  parse: (draft: Draft<Values>) => ParsedDraft<Values>;
  /** The form's inputs, for both creating and editing. */
  Fields: ComponentType<MenuFieldsProps<Values>>;
  /** A short line under a row's name, e.g. "Classic · $10.99". */
  summary: (row: Row) => string;
  /** Longer text under the summary, e.g. a menu item's description. Empty text shows nothing. */
  details?: (row: Row) => string;
}

/** One field's text, checked: its request value, or why it is wrong. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** A menu item or topping name: required, and at most 80 characters once trimmed. */
export function checkName(text: string): Checked<string> {
  return checkText(text, 'Name', { required: true, maxLength: MAX_CATALOG_NAME_LENGTH });
}

/** A menu item category: required, and at most 40 characters once trimmed. */
export function checkCategory(text: string): Checked<string> {
  return checkText(text, 'Category', {
    required: true,
    maxLength: MAX_MENU_ITEM_CATEGORY_LENGTH,
  });
}

/** A menu item description: may be empty, and at most 500 characters once trimmed. */
export function checkDescription(text: string): Checked<string> {
  return checkText(text, 'Description', {
    required: false,
    maxLength: MAX_MENU_ITEM_DESCRIPTION_LENGTH,
  });
}

/**
 * A price typed in dollars, read as whole cents from $0.00 to $1,000.00. The
 * text is parsed by parseDollarsToCents, so there is no float rounding.
 */
export function checkPrice(text: string): Checked<number> {
  if (text.trim() === '') {
    return { ok: false, error: 'Price is required' };
  }
  const cents = parseDollarsToCents(text);
  if (cents === null) {
    return { ok: false, error: 'Enter a price in dollars and cents, like 12.99' };
  }
  if (cents > MAX_CATALOG_PRICE_CENTS) {
    return { ok: false, error: `Price must be at most ${formatCents(MAX_CATALOG_PRICE_CENTS)}` };
  }
  return { ok: true, value: cents };
}

export function parseMenuItemDraft(draft: Draft<MenuItemValues>): ParsedDraft<MenuItemValues> {
  const name = checkName(draft.name);
  const description = checkDescription(draft.description);
  const category = checkCategory(draft.category);
  const basePriceCents = checkPrice(draft.basePriceCents);
  if (name.ok && description.ok && category.ok && basePriceCents.ok) {
    return {
      ok: true,
      values: {
        name: name.value,
        description: description.value,
        category: category.value,
        basePriceCents: basePriceCents.value,
      },
    };
  }
  return {
    ok: false,
    errors: {
      name: errorOf(name),
      description: errorOf(description),
      category: errorOf(category),
      basePriceCents: errorOf(basePriceCents),
    },
  };
}

export function parseToppingDraft(draft: Draft<ToppingValues>): ParsedDraft<ToppingValues> {
  const name = checkName(draft.name);
  const priceCents = checkPrice(draft.priceCents);
  if (name.ok && priceCents.ok) {
    return { ok: true, values: { name: name.value, priceCents: priceCents.value } };
  }
  return { ok: false, errors: { name: errorOf(name), priceCents: errorOf(priceCents) } };
}

/**
 * The fields whose values differ. An edit sends only these, so saving never
 * puts back an old value over a field that someone else changed meanwhile.
 */
export function changedValues<Values extends object>(
  before: Values,
  after: Values,
): Partial<Values> {
  const changes: Partial<Values> = {};
  // Object.keys types its result as string[]; the keys of `after` are its own.
  for (const key of Object.keys(after) as (keyof Values)[]) {
    if (after[key] !== before[key]) {
      changes[key] = after[key];
    }
  }
  return changes;
}

/**
 * Whether a save failed with 409 CONFLICT because another row has the name.
 * The page's list is out of date then, so it loads again (ADR 0007 rule 5)
 * and shows the row that holds the name.
 */
export function isNameConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'CONFLICT';
}

function checkText(
  text: string,
  label: string,
  { required, maxLength }: { required: boolean; maxLength: number },
): Checked<string> {
  // Lengths are JavaScript string lengths after trimming, as on the server.
  const value = text.trim();
  if (required && value === '') {
    return { ok: false, error: `${label} is required` };
  }
  if (value.length > maxLength) {
    return { ok: false, error: `${label} must be at most ${maxLength} characters` };
  }
  return { ok: true, value };
}

function errorOf(checked: Checked<unknown>): string | undefined {
  return checked.ok ? undefined : checked.error;
}
