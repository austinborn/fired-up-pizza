// Domain model from docs/PROJECT_MANIFEST.md. These are the API-facing shapes:
// camelCase keys, integer cents for money (ADR 0003), ISO-8601 UTC strings for
// timestamps, and booleans for availability flags. Repositories map SQLite rows
// (snake_case, 0/1) to these types; nothing else redeclares them.

export const ORDER_STATUSES = ['placed', 'preparing', 'ready', 'delivered', 'cancelled'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export interface MenuItem {
  id: number;
  name: string;
  description: string;
  category: string;
  basePriceCents: number;
  available: boolean;
  createdAt: string;
}

export interface Size {
  id: number;
  name: string;
  priceMultiplier: number;
}

export interface Crust {
  id: number;
  name: string;
  priceDeltaCents: number;
}

export interface Topping {
  id: number;
  name: string;
  priceCents: number;
  available: boolean;
}

/** Customers have no entity: an order is identified by its phone number (ADR 0005). */
export interface Order {
  id: number;
  phoneNumber: string;
  status: OrderStatus;
  totalCents: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** `unitPriceCents` is a snapshot taken when the order was placed (ADR 0003). */
export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number;
  sizeId: number;
  crustId: number;
  quantity: number;
  unitPriceCents: number;
}

/** `priceCents` is a snapshot taken when the order was placed (ADR 0003). */
export interface OrderItemTopping {
  orderItemId: number;
  toppingId: number;
  priceCents: number;
}

/** Audit trail row; `fromStatus` is null for the initial `placed` event (ADR 0004). */
export interface OrderStatusEvent {
  id: number;
  orderId: number;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  changedAt: string;
}
