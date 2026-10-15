import type { MenuItem, Topping } from '@fired-up-pizza/shared';
import {
  MAX_CATALOG_NAME_LENGTH,
  MAX_CATALOG_PRICE_CENTS,
  MAX_MENU_ITEM_CATEGORY_LENGTH,
  MAX_MENU_ITEM_DESCRIPTION_LENGTH,
  type CreateMenuItemRequest,
  type CreateToppingRequest,
  type UpdateMenuItemRequest,
  type UpdateToppingRequest,
} from '@fired-up-pizza/shared/staff-catalog-api';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies';
import { AppError } from '../../http/errors';
import { parseWith, type ValidationIssue } from '../../http/validate';
import {
  createCatalogRepository,
  type CatalogWriteResult,
  type MenuItemFields,
  type ToppingFields,
} from '../../repositories/catalog';

const catalogName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(MAX_CATALOG_NAME_LENGTH, `Name must be at most ${MAX_CATALOG_NAME_LENGTH} characters`);

const PRICE_RANGE_MESSAGE = `Price must be from 0 to ${MAX_CATALOG_PRICE_CENTS} cents`;

const priceCents = z
  .number()
  .int('Price must be a whole number of cents')
  .min(0, PRICE_RANGE_MESSAGE)
  .max(MAX_CATALOG_PRICE_CENTS, PRICE_RANGE_MESSAGE);

const menuItemFields = {
  name: catalogName,
  description: z
    .string()
    .trim()
    .max(
      MAX_MENU_ITEM_DESCRIPTION_LENGTH,
      `Description must be at most ${MAX_MENU_ITEM_DESCRIPTION_LENGTH} characters`,
    ),
  category: z
    .string()
    .trim()
    .min(1, 'Category is required')
    .max(
      MAX_MENU_ITEM_CATEGORY_LENGTH,
      `Category must be at most ${MAX_MENU_ITEM_CATEGORY_LENGTH} characters`,
    ),
  basePriceCents: priceCents,
  available: z.boolean(),
};

const toppingFields = { name: catalogName, priceCents, available: z.boolean() };

// Object schemas strip unknown keys (ADR 0006 rule 4), so a request cannot set
// `id` or `createdAt`. Each `satisfies` checks at compile time that a schema's
// input fits its shared request type and its output fits what the repository
// writes.
const createMenuItemBody = z.object({
  ...menuItemFields,
  available: menuItemFields.available.default(true),
}) satisfies z.ZodType<MenuItemFields, CreateMenuItemRequest>;
const updateMenuItemBody = z.object(menuItemFields).partial() satisfies z.ZodType<
  Partial<MenuItemFields>,
  UpdateMenuItemRequest
>;
const createToppingBody = z.object({
  ...toppingFields,
  available: toppingFields.available.default(true),
}) satisfies z.ZodType<ToppingFields, CreateToppingRequest>;
const updateToppingBody = z.object(toppingFields).partial() satisfies z.ZodType<
  Partial<ToppingFields>,
  UpdateToppingRequest
>;

const ID_MESSAGE = 'Id must be a positive whole number';

/**
 * Path ids are plain decimal digits, so "1e3", "0x10", and " 7" are rejected
 * rather than coerced. Larger ids than Number.MAX_SAFE_INTEGER would lose
 * precision and could name a different row.
 */
const idParams = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/, ID_MESSAGE)
    .transform(Number)
    .pipe(z.number().max(Number.MAX_SAFE_INTEGER, ID_MESSAGE)),
});

interface WriteMessages {
  notFound: string;
  nameTaken: string;
}

const MENU_ITEM: WriteMessages = {
  notFound: 'Menu item not found',
  nameTaken: 'A menu item with this name already exists',
};

const TOPPING: WriteMessages = {
  notFound: 'Topping not found',
  nameTaken: 'A topping with this name already exists',
};

/**
 * Returns the written row, or throws why nothing was written. A taken name is a
 * 409 CONFLICT whose details have the VALIDATION_ERROR shape (ADR 0006 rule 4),
 * so the staff page can show it next to the name field.
 */
function written<T>(result: CatalogWriteResult<T>, messages: WriteMessages): T {
  if (result.ok) {
    return result.value;
  }
  if (result.failure === 'not-found') {
    throw new AppError('NOT_FOUND', messages.notFound);
  }
  const issues: ValidationIssue[] = [{ path: 'name', message: messages.nameTaken }];
  throw new AppError('CONFLICT', messages.nameTaken, { issues });
}

/**
 * Staff menu management, mounted at /api/staff behind requireStaff (ADR 0006
 * rules 2 and 3). Request types and field limits live in
 * @fired-up-pizza/shared/staff-catalog-api. Responses are the shared MenuItem
 * and Topping types.
 *   GET   /api/staff/menu-items       every item, hidden ones included
 *   POST  /api/staff/menu-items       create (201)
 *   PATCH /api/staff/menu-items/:id   change any subset of fields
 *   GET   /api/staff/toppings         every topping, hidden ones included
 *   POST  /api/staff/toppings         create (201)
 *   PATCH /api/staff/toppings/:id     change any subset of fields
 * Hiding is a PATCH with `available: false`. There is no DELETE, so past orders
 * keep their references (ADR 0002 rule 7).
 */
export function createStaffCatalogRouter({ db }: AppDependencies): Router {
  const router = Router();
  const catalog = createCatalogRepository(db);

  router.get('/menu-items', (_req, res) => {
    const menuItems: MenuItem[] = catalog.listMenuItems({ includeUnavailable: true });
    res.json(menuItems);
  });

  router.post('/menu-items', (req, res) => {
    const fields = parseWith(createMenuItemBody, req.body);
    const menuItem: MenuItem = written(catalog.createMenuItem(fields), MENU_ITEM);
    res.status(201).json(menuItem);
  });

  router.patch('/menu-items/:id', (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const changes = parseWith(updateMenuItemBody, req.body);
    const menuItem: MenuItem = written(catalog.updateMenuItem(id, changes), MENU_ITEM);
    res.json(menuItem);
  });

  router.get('/toppings', (_req, res) => {
    const toppings: Topping[] = catalog.listToppings({ includeUnavailable: true });
    res.json(toppings);
  });

  router.post('/toppings', (req, res) => {
    const fields = parseWith(createToppingBody, req.body);
    const topping: Topping = written(catalog.createTopping(fields), TOPPING);
    res.status(201).json(topping);
  });

  router.patch('/toppings/:id', (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const changes = parseWith(updateToppingBody, req.body);
    const topping: Topping = written(catalog.updateTopping(id, changes), TOPPING);
    res.json(topping);
  });

  return router;
}
