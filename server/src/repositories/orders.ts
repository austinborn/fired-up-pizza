// Order inserts and the order read model (ADR 0002 rule 5). The status SQL is
// elsewhere: orders.status and the status history belong to
// server/src/repositories/order-status.ts and its service (ADR 0004 rule 4).
// This module only reads the history, through listOrderStatusEvents.
//
// insertOrder never names a status, so a new row starts as placed by the column
// default. The place-order service (server/src/services/orders.ts) calls it and
// then records the initial status event, in one transaction.
//
// The read model returns OrderDetails from @fired-up-pizza/shared/orders-api for
// the place-order response, the customer order lookup, and the staff queue. Its
// money comes only from the snapshot columns (orders.total_cents,
// order_items.unit_price_cents, and order_item_toppings.price_cents), never from
// current catalog prices, so menu edits never change an existing order
// (ADR 0003 rule 4). Display names are joined from the catalog as they are now.

import {
  ORDER_STATUSES,
  type Order,
  type OrderItem,
  type OrderItemTopping,
  type OrderStatus,
} from '@fired-up-pizza/shared';
import type {
  OrderDetails,
  OrderDetailsItem,
  OrderDetailsTopping,
} from '@fired-up-pizza/shared/orders-api';
import type { Db } from '../db/connection';
import { listOrderStatusEvents } from './order-status';

/** A line of a new order, priced by the server (ADR 0003 rule 3). */
export interface NewOrderItem extends Omit<OrderItem, 'id' | 'orderId'> {
  /** Each topping with the price it is charged, in the order to show them. */
  toppings: readonly Omit<OrderItemTopping, 'orderItemId'>[];
}

/**
 * A new order. There is no status field, because every order starts as placed
 * (ADR 0004 rule 1). Its updatedAt starts equal to its createdAt.
 */
export interface NewOrder extends Pick<
  Order,
  'phoneNumber' | 'totalCents' | 'notes' | 'createdAt'
> {
  /** In the order to show them. */
  items: readonly NewOrderItem[];
}

/** `newest`: the latest createdAt first. `oldest`: the earliest first. */
export type OrderSort = 'newest' | 'oldest';

/** Which orders listOrderDetails returns, and in what order. */
export interface OrderDetailsQuery {
  /** Only this customer's orders: the E.164 phone number from server/src/identity/. */
  phoneNumber?: string;
  /** Only orders in these statuses. Omitted means every status; an empty list matches nothing. */
  statuses?: readonly OrderStatus[];
  /** The most orders to return: a whole number from 1. */
  limit: number;
  sort: OrderSort;
}

/**
 * Inserts an order with its lines and their toppings, and returns the order's
 * id. Prices are stored exactly as given. The order is placed, and its
 * createdAt is also its updatedAt.
 *
 * Call it inside the transaction that also records the order's initial status
 * (ADR 0004 rule 4), so an order is never stored without that event or without
 * some of its lines. Outside a transaction it throws a plain Error, which
 * becomes a 500, and writes nothing.
 */
export function insertOrder(db: Db, order: NewOrder): number {
  if (!db.inTransaction) {
    throw new Error(
      'Cannot insert an order outside a transaction: insert it in the transaction that records its initial status',
    );
  }
  const insertOrderRow = db.prepare<Omit<NewOrder, 'items'>>(
    `INSERT INTO orders (phone_number, total_cents, notes, created_at, updated_at)
     VALUES (@phoneNumber, @totalCents, @notes, @createdAt, @createdAt)`,
  );
  const insertItem = db.prepare<Omit<OrderItem, 'id'>>(
    `INSERT INTO order_items (order_id, menu_item_id, size_id, crust_id, quantity, unit_price_cents)
     VALUES (@orderId, @menuItemId, @sizeId, @crustId, @quantity, @unitPriceCents)`,
  );
  const insertTopping = db.prepare<OrderItemTopping>(
    `INSERT INTO order_item_toppings (order_item_id, topping_id, price_cents)
     VALUES (@orderItemId, @toppingId, @priceCents)`,
  );

  const { phoneNumber, totalCents, notes, createdAt } = order;
  const orderId = Number(
    insertOrderRow.run({ phoneNumber, totalCents, notes, createdAt }).lastInsertRowid,
  );
  for (const { menuItemId, sizeId, crustId, quantity, unitPriceCents, toppings } of order.items) {
    const orderItemId = Number(
      insertItem.run({ orderId, menuItemId, sizeId, crustId, quantity, unitPriceCents })
        .lastInsertRowid,
    );
    for (const { toppingId, priceCents } of toppings) {
      insertTopping.run({ orderItemId, toppingId, priceCents });
    }
  }
  return orderId;
}

/** The orders columns, named as the Order fields. */
const ORDER_COLUMNS = `id, phone_number AS phoneNumber, status, total_cents AS totalCents, notes,
       created_at AS createdAt, updated_at AS updatedAt`;

/** The order with this id, with its lines and status history, or undefined. */
export function getOrderDetails(db: Db, orderId: number): OrderDetails | undefined {
  const order = db
    .prepare<[number], Order>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?`)
    .get(orderId);
  return order === undefined ? undefined : withDetails(db, [order])[0];
}

/**
 * The WHERE clause of listOrderDetails, with or without a phone number. With
 * one, SQLite finds the customer's orders through the orders_by_phone_number
 * index, already in time order. Without one, it uses orders_by_status. The
 * statuses are bound as one JSON array, so one statement serves any set of
 * them.
 */
const FILTER = {
  anyPhone: 'status IN (SELECT value FROM json_each(@statuses))',
  onePhone: 'phone_number = @phoneNumber AND status IN (SELECT value FROM json_each(@statuses))',
} as const;

/**
 * The ORDER BY clause for each sort. Only these fixed strings reach the SQL,
 * never a value from the caller (ADR 0002 rule 5). The id breaks ties between
 * orders created in the same millisecond, in the same direction.
 */
const ORDER_BY: Readonly<Record<OrderSort, string>> = {
  newest: 'created_at DESC, id DESC',
  oldest: 'created_at, id',
};

interface ListParams {
  /** JSON array of OrderStatus values. */
  statuses: string;
  limit: number;
  phoneNumber?: string;
}

/**
 * Up to `limit` orders that match the query, sorted by createdAt, each with its
 * lines and status history. Throws a RangeError for a limit that is not a whole
 * number from 1, or an unknown sort, since either would be a bug in the caller.
 */
export function listOrderDetails(db: Db, query: OrderDetailsQuery): OrderDetails[] {
  const { phoneNumber, statuses = ORDER_STATUSES, limit, sort } = query;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`limit must be a whole number from 1, got ${limit}`);
  }
  if (!Object.hasOwn(ORDER_BY, sort)) {
    throw new RangeError(`sort must be newest or oldest, got ${sort}`);
  }
  const filter = phoneNumber === undefined ? FILTER.anyPhone : FILTER.onePhone;
  const params: ListParams = { statuses: JSON.stringify(statuses), limit };
  if (phoneNumber !== undefined) {
    params.phoneNumber = phoneNumber;
  }
  const orders = db
    .prepare<ListParams, Order>(
      `SELECT ${ORDER_COLUMNS} FROM orders
       WHERE ${filter}
       ORDER BY ${ORDER_BY[sort]}
       LIMIT @limit`,
    )
    .all(params);
  return withDetails(db, orders);
}

/** A row of the lines query: a line without its toppings, plus its order's id. */
type ItemRow = Omit<OrderDetailsItem, 'toppings'> & Pick<OrderItem, 'orderId'>;

/** A row of the toppings query: a topping plus its line's id. */
type ToppingRow = OrderDetailsTopping & Pick<OrderItemTopping, 'orderItemId'>;

/**
 * Adds each order's lines, toppings, and status history: three queries for any
 * number of orders. The order ids are bound as one JSON array parameter, so no
 * SQL is built from them (ADR 0002 rule 5).
 */
function withDetails(db: Db, orders: readonly Order[]): OrderDetails[] {
  if (orders.length === 0) {
    return [];
  }
  const orderIds = orders.map(({ id }) => id);
  const orderIdsParam = JSON.stringify(orderIds);
  // A line's id is its rowid, so ordering by it lists the lines as they were
  // placed.
  const itemRows = db
    .prepare<[string], ItemRow>(
      `SELECT item.id, item.order_id AS orderId,
              item.menu_item_id AS menuItemId, menu_item.name AS menuItemName,
              item.size_id AS sizeId, size.name AS sizeName,
              item.crust_id AS crustId, crust.name AS crustName,
              item.quantity, item.unit_price_cents AS unitPriceCents
       FROM order_items AS item
       JOIN menu_items AS menu_item ON menu_item.id = item.menu_item_id
       JOIN sizes AS size ON size.id = item.size_id
       JOIN crusts AS crust ON crust.id = item.crust_id
       WHERE item.order_id IN (SELECT value FROM json_each(?))
       ORDER BY item.id`,
    )
    .all(orderIdsParam);
  // SQLite gives each inserted order_item_toppings row a rowid above every
  // existing one, so ordering by rowid keeps each line's toppings in the order
  // the customer chose them.
  const toppingRows = db
    .prepare<[string], ToppingRow>(
      `SELECT item_topping.order_item_id AS orderItemId, item_topping.topping_id AS toppingId,
              topping.name AS toppingName, item_topping.price_cents AS priceCents
       FROM order_item_toppings AS item_topping
       JOIN order_items AS item ON item.id = item_topping.order_item_id
       JOIN toppings AS topping ON topping.id = item_topping.topping_id
       WHERE item.order_id IN (SELECT value FROM json_each(?))
       ORDER BY item_topping.rowid`,
    )
    .all(orderIdsParam);

  const itemsByOrder = groupBy(itemRows, (row) => row.orderId);
  const toppingsByItem = groupBy(toppingRows, (row) => row.orderItemId);
  const eventsByOrder = groupBy(listOrderStatusEvents(db, orderIds), (event) => event.orderId);
  return orders.map((order) => ({
    ...order,
    items: (itemsByOrder.get(order.id) ?? []).map(({ orderId: _orderId, ...item }) => ({
      ...item,
      toppings: (toppingsByItem.get(item.id) ?? []).map(
        ({ orderItemId: _orderItemId, ...topping }) => topping,
      ),
    })),
    statusEvents: (eventsByOrder.get(order.id) ?? []).map(
      ({ orderId: _orderId, ...event }) => event,
    ),
  }));
}

/** Splits rows into lists by key. Each list keeps the order of the rows. */
function groupBy<Row, Key>(rows: readonly Row[], keyOf: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [row]);
    } else {
      group.push(row);
    }
  }
  return groups;
}
