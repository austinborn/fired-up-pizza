import type { MenuItem, Topping } from '@fired-up-pizza/shared';
import {
  createMenuItem,
  createTopping,
  getStaffMenuItems,
  getStaffToppings,
  updateMenuItem,
  updateTopping,
} from '../../api/staff-catalog';
import {
  parseMenuItemDraft,
  parseToppingDraft,
  type MenuCatalog,
  type MenuItemValues,
  type ToppingValues,
} from '../../components/staff/menu-catalog';
import { MenuCatalogSection } from '../../components/staff/MenuCatalogSection';
import { MenuItemFields, MenuToppingFields } from '../../components/staff/MenuFormFields';
import { formatCents, formatCentsForInput } from '../../lib/money';

const MENU_ITEMS: MenuCatalog<MenuItem, MenuItemValues> = {
  title: 'Menu items',
  noun: 'menu item',
  description:
    'The pizzas customers order. Hidden items stay listed here, but customers cannot see or order them.',
  list: getStaffMenuItems,
  create: createMenuItem,
  update: updateMenuItem,
  setAvailable: (id, available) => updateMenuItem(id, { available }),
  emptyDraft: { name: '', category: '', basePriceCents: '', description: '' },
  draftOf: (item) => ({
    name: item.name,
    category: item.category,
    basePriceCents: formatCentsForInput(item.basePriceCents),
    description: item.description,
  }),
  parse: parseMenuItemDraft,
  Fields: MenuItemFields,
  summary: (item) => `${item.category} · ${formatCents(item.basePriceCents)}`,
  details: (item) => item.description,
};

const TOPPINGS: MenuCatalog<Topping, ToppingValues> = {
  title: 'Toppings',
  noun: 'topping',
  description:
    'The extras customers add in the pizza builder. Hidden toppings stay listed here, but customers cannot choose them.',
  list: getStaffToppings,
  create: createTopping,
  update: updateTopping,
  setAvailable: (id, available) => updateTopping(id, { available }),
  emptyDraft: { name: '', priceCents: '' },
  draftOf: (topping) => ({
    name: topping.name,
    priceCents: formatCentsForInput(topping.priceCents),
  }),
  parse: parseToppingDraft,
  Fields: MenuToppingFields,
  summary: (topping) => formatCents(topping.priceCents),
};

/**
 * Staff menu management at /staff/menu: create, edit, and hide or show menu
 * items and toppings. Nothing is ever deleted, so past orders keep what they
 * reference, and orders already placed keep the prices they were placed at
 * (ADR 0003 rule 4).
 */
export function StaffMenuPage() {
  return (
    <div className="space-y-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Menu management</h1>
        <p className="text-stone-600">
          Add, edit, and hide pizzas and toppings. Price changes apply to new orders only; orders
          already placed keep their prices. Nothing is deleted, so hide anything you are not
          serving.
        </p>
      </div>
      <MenuCatalogSection catalog={MENU_ITEMS} />
      <MenuCatalogSection catalog={TOPPINGS} />
    </div>
  );
}
