import type { MenuItem } from '@fired-up-pizza/shared';
import { useId } from 'react';
import { getMenuItems } from '../../api/catalog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { MenuItemCard } from '../../components/MenuItemCard';
import { useAsync } from '../../hooks/useAsync';

/**
 * The customer menu at "/": every available pizza, grouped by category, each
 * linking to its builder page. The menu loads once per visit. It is not a live
 * view, so it does not poll (ADR 0007 rule 4).
 */
export function MenuPage() {
  const { data: menuItems, error, reload } = useAsync((signal) => getMenuItems({ signal }), []);

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Menu</h1>
        <p className="text-stone-600">Pick a pizza, then choose its size, crust, and toppings.</p>
      </div>
      <MenuContent menuItems={menuItems} error={error} onRetry={reload} />
    </section>
  );
}

interface MenuContentProps {
  menuItems: MenuItem[] | undefined;
  error: Error | null;
  onRetry: () => void;
}

/** The menu, or its loading, error-with-retry, or empty state (ADR 0007 rule 5). */
function MenuContent({ menuItems, error, onRetry }: MenuContentProps) {
  if (menuItems === undefined) {
    return error === null ? (
      <LoadingState label="Loading the menu…" />
    ) : (
      <ErrorState title="Couldn't load the menu" error={error} onRetry={onRetry} />
    );
  }
  if (menuItems.length === 0) {
    return <EmptyState title="Our menu is being updated">Please check back soon.</EmptyState>;
  }
  return (
    <div className="space-y-10">
      {groupByCategory(menuItems).map(({ key, category, menuItems: items }) => (
        <CategorySection key={key} category={category} menuItems={items} />
      ))}
    </div>
  );
}

function CategorySection({ category, menuItems }: { category: string; menuItems: MenuItem[] }) {
  const headingId = useId();
  return (
    <section>
      <h2 id={headingId} className="text-xl font-semibold tracking-tight text-stone-900">
        {category}
      </h2>
      {/* role="list" keeps the list semantics that Safari drops from unstyled lists. */}
      <ul
        role="list"
        aria-labelledby={headingId}
        className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {menuItems.map((menuItem) => (
          <li key={menuItem.id}>
            <MenuItemCard menuItem={menuItem} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface MenuCategory {
  /** The category, lowercased: categories that differ only in case share one group. */
  key: string;
  /** The category as the group's first menu item spells it. */
  category: string;
  menuItems: MenuItem[];
}

/**
 * Splits the menu into categories and keeps the server's order: categories
 * appear where their first item does, and items keep their order within each
 * category. The server sorts categories ignoring case, so spellings that
 * differ only in case, such as "Veggie" and "veggie", form one group.
 */
function groupByCategory(menuItems: readonly MenuItem[]): MenuCategory[] {
  const groups = new Map<string, MenuCategory>();
  for (const menuItem of menuItems) {
    const key = menuItem.category.toLowerCase();
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { key, category: menuItem.category, menuItems: [menuItem] });
    } else {
      group.menuItems.push(menuItem);
    }
  }
  return [...groups.values()];
}
