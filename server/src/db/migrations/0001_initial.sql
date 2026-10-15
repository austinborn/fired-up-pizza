-- 0001_initial: every Domain Model table in docs/PROJECT_MANIFEST.md.
--
-- Storage conventions (ADR 0002 rule 6): snake_case columns, INTEGER primary
-- keys, money as INTEGER cents named *_cents (ADR 0003), booleans as INTEGER
-- 0/1, timestamps as ISO-8601 UTC TEXT such as 2026-10-14T23:20:00.000Z.
-- Tables are STRICT, so SQLite rejects a fractional cents value instead of
-- quietly storing a REAL.
--
-- Rows that orders reference are hidden (available = 0), never deleted, so every
-- foreign key is ON DELETE RESTRICT (ADR 0002 rule 7). The status values are
-- ORDER_STATUSES from shared/src/domain.ts (ADR 0004 rule 1); which transitions
-- are legal is decided in code, not here.
--
-- The migration runner wraps this file in a transaction, so it has no BEGIN or
-- COMMIT. Never edit it once applied: change the schema in a new migration
-- (ADR 0002 rule 3).

CREATE TABLE menu_items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> ''),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (trim(category) <> ''),
  base_price_cents INTEGER NOT NULL CHECK (base_price_cents >= 0),
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE sizes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> ''),
  price_multiplier REAL NOT NULL CHECK (price_multiplier > 0)
) STRICT;

CREATE TABLE crusts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> ''),
  price_delta_cents INTEGER NOT NULL CHECK (price_delta_cents >= 0)
) STRICT;

CREATE TABLE toppings (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (trim(name) <> ''),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1))
) STRICT;

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  phone_number TEXT NOT NULL CHECK (phone_number <> ''),
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed', 'preparing', 'ready', 'delivered', 'cancelled')),
  total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- A customer's orders by phone (ADR 0005 rule 4) and the staff queue by status,
-- each in time order.
CREATE INDEX orders_by_phone_number ON orders (phone_number, created_at);
CREATE INDEX orders_by_status ON orders (status, created_at);

CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  menu_item_id INTEGER NOT NULL REFERENCES menu_items (id) ON DELETE RESTRICT,
  size_id INTEGER NOT NULL REFERENCES sizes (id) ON DELETE RESTRICT,
  crust_id INTEGER NOT NULL REFERENCES crusts (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity >= 1),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
) STRICT;

CREATE INDEX order_items_by_order ON order_items (order_id);

CREATE TABLE order_item_toppings (
  order_item_id INTEGER NOT NULL REFERENCES order_items (id) ON DELETE RESTRICT,
  topping_id INTEGER NOT NULL REFERENCES toppings (id) ON DELETE RESTRICT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  PRIMARY KEY (order_item_id, topping_id)
) STRICT;

-- from_status is NULL on the event that records a new order (ADR 0004 rule 4).
CREATE TABLE order_status_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  from_status TEXT
    CHECK (from_status IS NULL OR from_status IN ('placed', 'preparing', 'ready', 'delivered', 'cancelled')),
  to_status TEXT NOT NULL
    CHECK (to_status IN ('placed', 'preparing', 'ready', 'delivered', 'cancelled')),
  changed_at TEXT NOT NULL
) STRICT;

CREATE INDEX order_status_events_by_order ON order_status_events (order_id, changed_at);
