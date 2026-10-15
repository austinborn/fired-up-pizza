import { ORDER_STATUSES } from '@fired-up-pizza/shared';
import { LIVE_ORDER_STATUSES } from '@fired-up-pizza/shared/order-status';
import type { OrderDetails } from '@fired-up-pizza/shared/orders-api';
import type {
  StaffOrdersQuery,
  UpdateOrderStatusRequest,
} from '@fired-up-pizza/shared/staff-orders-api';
import { Router } from 'express';
import { z } from 'zod';
import type { AppDependencies } from '../../app-dependencies';
import type { Db } from '../../db/connection';
import { parseWith } from '../../http/validate';
import { getOrderDetails, listOrderDetails } from '../../repositories/orders';
import { transitionOrderStatus } from '../../services/order-status';

const orderStatus = z.enum(ORDER_STATUSES, {
  error: `Status must be one of ${ORDER_STATUSES.join(', ')}`,
});

// `?statuses=placed,ready` arrives as one string. The query parser turns a
// repeated parameter into an array, which is rejected rather than merged, so the
// filter has one spelling. Splitting before the enum check lets each issue name
// the entry at fault, such as `statuses.1`. Unknown keys are stripped (ADR 0006
// rule 4). The `satisfies` checks at compile time that the parsed query fits
// StaffOrdersQuery.
const staffOrdersQuery = z.object({
  statuses: z
    .string({ error: 'Statuses must be sent once, as a comma-separated list' })
    .transform((statuses) => statuses.split(','))
    .pipe(z.array(orderStatus))
    .optional(),
}) satisfies z.ZodType<StaffOrdersQuery>;

const updateOrderStatusBody = z.object({ status: orderStatus }) satisfies z.ZodType<
  UpdateOrderStatusRequest,
  UpdateOrderStatusRequest
>;

const ID_MESSAGE = 'Id must be a positive whole number';

/**
 * Path ids, checked as the staff catalog routes check theirs: plain decimal
 * digits, so "1e3", "0x10", and "07" are rejected rather than coerced, and no
 * larger than Number.MAX_SAFE_INTEGER, beyond which an id could name a
 * different order.
 */
const idParams = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/, ID_MESSAGE)
    .transform(Number)
    .pipe(z.number().max(Number.MAX_SAFE_INTEGER, ID_MESSAGE)),
});

/**
 * The queue's limit for listOrderDetails, which needs one: every matching
 * order. Sorted oldest first, a smaller cap would drop the newest orders, the
 * ones the kitchen has not seen yet.
 */
const EVERY_ORDER = Number.MAX_SAFE_INTEGER;

/**
 * Staff order queue, mounted at /api/staff behind requireStaff (ADR 0006 rules
 * 2 and 3). Request types live in @fired-up-pizza/shared/staff-orders-api, and
 * both endpoints answer with OrderDetails, phone numbers included (ADR 0005
 * rule 4).
 *   GET   /api/staff/orders             live orders, or ?statuses=a,b; oldest first
 *   PATCH /api/staff/orders/:id/status  { status }: 200 with the changed order
 * Every status change goes through transitionOrderStatus (ADR 0004 rule 4),
 * which throws the 404 NOT_FOUND and 409 ILLEGAL_STATUS_TRANSITION errors.
 */
export function createStaffOrdersRouter({ db }: AppDependencies): Router {
  const router = Router();

  router.get('/orders', (req, res) => {
    const { statuses = LIVE_ORDER_STATUSES } = parseWith(staffOrdersQuery, req.query);
    const orders: OrderDetails[] = listOrderDetails(db, {
      statuses,
      limit: EVERY_ORDER,
      sort: 'oldest',
    });
    res.json(orders);
  });

  router.patch('/orders/:id/status', (req, res) => {
    const { id } = parseWith(idParams, req.params);
    const { status } = parseWith(updateOrderStatusBody, req.body);
    transitionOrderStatus(db, id, status);
    res.json(changedOrder(db, id));
  });

  return router;
}

/**
 * The order whose status just changed. Orders are never deleted, so a missing
 * one is a bug: it throws a plain Error, which becomes a generic 500.
 */
function changedOrder(db: Db, orderId: number): OrderDetails {
  const order = getOrderDetails(db, orderId);
  if (order === undefined) {
    throw new Error(`Order ${orderId} is missing right after its status changed`);
  }
  return order;
}
