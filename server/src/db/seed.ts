import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import type { Db } from './connection';

/**
 * A catalog row as the seed writes it. The database assigns the id, every
 * seeded row starts available, and menu items get the seeding time as createdAt.
 */
type SeedRow<T> = Omit<T, 'id' | 'available' | 'createdAt'>;

export interface CatalogSeed {
  sizes: readonly SeedRow<Size>[];
  crusts: readonly SeedRow<Crust>[];
  toppings: readonly SeedRow<Topping>[];
  menuItems: readonly SeedRow<MenuItem>[];
}

/**
 * The starter catalog that a new database gets. Money is integer cents
 * (ADR 0003). From the first start on, the catalog belongs to staff, who edit and
 * hide rows; the seed never touches it again.
 */
export const CATALOG_SEED = {
  sizes: [
    { name: 'Small', priceMultiplier: 1 },
    { name: 'Medium', priceMultiplier: 1.25 },
    { name: 'Large', priceMultiplier: 1.5 },
  ],
  crusts: [
    { name: 'Hand-Tossed', priceDeltaCents: 0 },
    { name: 'Thin & Crispy', priceDeltaCents: 0 },
    { name: 'Stuffed Crust', priceDeltaCents: 200 },
    { name: 'Gluten-Free', priceDeltaCents: 300 },
  ],
  toppings: [
    { name: 'Pepperoni', priceCents: 200 },
    { name: 'Italian Sausage', priceCents: 200 },
    { name: 'Bacon', priceCents: 200 },
    { name: 'Ham', priceCents: 200 },
    { name: 'Grilled Chicken', priceCents: 250 },
    { name: 'Extra Cheese', priceCents: 150 },
    { name: 'Mushrooms', priceCents: 150 },
    { name: 'Green Peppers', priceCents: 150 },
    { name: 'Red Onions', priceCents: 125 },
    { name: 'Black Olives', priceCents: 150 },
    { name: 'Pineapple', priceCents: 150 },
    { name: 'Fresh Basil', priceCents: 100 },
  ],
  menuItems: [
    {
      name: 'Cheese',
      description: 'Tomato sauce and a blend of mozzarella and provolone.',
      category: 'Classic',
      basePriceCents: 999,
    },
    {
      name: 'Margherita',
      description: 'San Marzano tomato sauce, fresh mozzarella, basil, and extra-virgin olive oil.',
      category: 'Classic',
      basePriceCents: 1099,
    },
    {
      name: 'Pepperoni',
      description: 'Tomato sauce, mozzarella, and crispy cup-and-char pepperoni.',
      category: 'Classic',
      basePriceCents: 1299,
    },
    {
      name: 'Hawaiian',
      description: 'Tomato sauce, mozzarella, ham, and pineapple.',
      category: 'Specialty',
      basePriceCents: 1399,
    },
    {
      name: 'BBQ Chicken',
      description: 'Smoky barbecue sauce, grilled chicken, red onions, mozzarella, and cilantro.',
      category: 'Specialty',
      basePriceCents: 1499,
    },
    {
      name: 'Fired Up',
      description:
        'Our house special: spicy soppressata, Calabrian chilies, mozzarella, and a drizzle of hot honey.',
      category: 'Specialty',
      basePriceCents: 1549,
    },
    {
      name: 'Meat Lovers',
      description: 'Pepperoni, Italian sausage, bacon, and ham over tomato sauce and mozzarella.',
      category: 'Specialty',
      basePriceCents: 1599,
    },
    {
      name: 'Garden Veggie',
      description:
        'Mushrooms, green peppers, red onions, black olives, and tomatoes on mozzarella.',
      category: 'Veggie',
      basePriceCents: 1349,
    },
    {
      name: 'Mediterranean',
      description: 'Spinach, artichoke hearts, kalamata olives, roasted red peppers, and feta.',
      category: 'Veggie',
      basePriceCents: 1449,
    },
  ],
} as const satisfies CatalogSeed;

/**
 * Inserts the starter catalog into an empty catalog (ADR 0002 rule 4). Empty
 * means no menu items, sizes, crusts, or toppings at all. A catalog with any row
 * is left untouched, so staff edits and hidden rows survive restarts. Everything
 * goes in one transaction: a failure leaves the catalog empty, and the next start
 * tries again. Returns whether it seeded.
 */
export function seedCatalog(db: Db, seed: CatalogSeed = CATALOG_SEED): boolean {
  const catalogHasRows = db
    .prepare<[], 0 | 1>(
      `SELECT EXISTS (SELECT 1 FROM menu_items)
           OR EXISTS (SELECT 1 FROM sizes)
           OR EXISTS (SELECT 1 FROM crusts)
           OR EXISTS (SELECT 1 FROM toppings)`,
    )
    .pluck();
  const insertSize = db.prepare<SeedRow<Size>>(
    'INSERT INTO sizes (name, price_multiplier) VALUES (@name, @priceMultiplier)',
  );
  const insertCrust = db.prepare<SeedRow<Crust>>(
    'INSERT INTO crusts (name, price_delta_cents) VALUES (@name, @priceDeltaCents)',
  );
  const insertTopping = db.prepare<SeedRow<Topping>>(
    'INSERT INTO toppings (name, price_cents, available) VALUES (@name, @priceCents, 1)',
  );
  const insertMenuItem = db.prepare<SeedRow<MenuItem> & Pick<MenuItem, 'createdAt'>>(
    `INSERT INTO menu_items (name, description, category, base_price_cents, available, created_at)
     VALUES (@name, @description, @category, @basePriceCents, 1, @createdAt)`,
  );

  const seedIfEmpty = db.transaction((): boolean => {
    if (catalogHasRows.get() === 1) {
      return false;
    }
    const createdAt = new Date().toISOString();
    for (const size of seed.sizes) {
      insertSize.run(size);
    }
    for (const crust of seed.crusts) {
      insertCrust.run(crust);
    }
    for (const topping of seed.toppings) {
      insertTopping.run(topping);
    }
    for (const menuItem of seed.menuItems) {
      insertMenuItem.run({ ...menuItem, createdAt });
    }
    return true;
  });
  // IMMEDIATE takes the write lock before the emptiness check, so two processes
  // starting at once cannot both seed.
  return seedIfEmpty.immediate();
}
