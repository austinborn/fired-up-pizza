import {
  MAX_ITEMS_PER_ORDER,
  MAX_ORDER_NOTES_LENGTH,
  type OrderDetails,
  type PlaceOrderRequest,
} from '@fired-up-pizza/shared/orders-api';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDependencies } from '../app-dependencies';
import { parseWith } from '../http/validate';
import { phoneNumberField, resolveCustomerIdentity } from '../identity';
import { placeOrder } from '../services/orders';

const ID_MESSAGE = 'Id must be a positive whole number';

/**
 * A catalog id. An id that is not a positive safe integer cannot name a row, so
 * it makes the request malformed (400) rather than the item unavailable (422).
 */
const catalogId = z.number().int(ID_MESSAGE).positive(ID_MESSAGE);

// Object schemas strip unknown keys (ADR 0006 rule 4), so prices, a status, or
// anything else a client adds never reaches the service (ADR 0003 rule 3).
// Quantities and toppings are checked against the ordering limits by the
// pricing service, which reports them as the same 400 VALIDATION_ERROR. The
// `satisfies` checks at compile time that the schema accepts no more than
// PlaceOrderRequest allows, and that its output has notes filled in.
const placeOrderBody = z.object({
  phoneNumber: phoneNumberField,
  notes: z
    .string()
    .trim()
    .max(MAX_ORDER_NOTES_LENGTH, `Notes must be at most ${MAX_ORDER_NOTES_LENGTH} characters`)
    .default(''),
  items: z
    .array(
      z.object({
        menuItemId: catalogId,
        sizeId: catalogId,
        crustId: catalogId,
        toppingIds: z.array(catalogId),
        quantity: z.number(),
      }),
    )
    .min(1, 'An order needs at least one item')
    .max(MAX_ITEMS_PER_ORDER, `An order can have at most ${MAX_ITEMS_PER_ORDER} items`),
}) satisfies z.ZodType<Required<PlaceOrderRequest>, PlaceOrderRequest>;

/**
 * Customer orders, mounted at /api (ADR 0006). Request and response types live
 * in @fired-up-pizza/shared/orders-api.
 *   POST /api/orders           place an order: 201 with its OrderDetails
 *   GET  /api/orders?phone=... look up a phone's orders (order lookup work item)
 * The phone number is checked and normalized only by resolveCustomerIdentity,
 * and never logged (ADR 0005 rules 2 and 5).
 */
export function createOrdersRouter({ db }: AppDependencies): Router {
  const router = Router();

  router.post('/orders', (req, res) => {
    const { phoneNumber, notes, items } = parseWith(placeOrderBody, req.body);
    const customer = resolveCustomerIdentity(phoneNumber);
    const order: OrderDetails = placeOrder(db, { customer, notes, items });
    res.status(201).json(order);
  });

  return router;
}
