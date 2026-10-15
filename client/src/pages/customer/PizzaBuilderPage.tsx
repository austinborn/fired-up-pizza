import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import { Link, useParams } from 'react-router-dom';
import { getCrusts, getMenuItems, getSizes, getToppings } from '../../api/catalog';
import { PizzaBuilderForm, type NonEmptyList } from '../../components/builder/PizzaBuilderForm';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { useAsync } from '../../hooks/useAsync';

/**
 * The pizza builder at /menu/:menuItemId, where a customer chooses a size,
 * crust, toppings, and quantity, then adds the pizza to the cart.
 *
 * It loads the customer catalog once per visit and does not poll, since it is
 * not a live view (ADR 0007 rule 4). The catalog has no endpoint for a single
 * menu item (ADR 0006 rule 2), so the page finds its pizza in the menu items
 * list. That list holds available items only, so an id that is unknown or
 * hidden by staff shows the not-found state.
 */
export function PizzaBuilderPage() {
  const { menuItemId } = useParams();
  const { data: catalog, error, reload } = useAsync((signal) => loadCatalog(signal), []);

  if (catalog === undefined) {
    return (
      <section className="space-y-8">
        <h1 className="text-2xl font-bold tracking-tight">Build your pizza</h1>
        {error === null ? (
          <LoadingState label="Loading the pizza builder…" />
        ) : (
          <ErrorState title="Couldn't load this pizza" error={error} onRetry={reload} />
        )}
      </section>
    );
  }

  // Menu links put the id in the path as String(id) does (MenuItemCard), so
  // the comparison is on that text: "/menu/02" or "/menu/2.0" names no pizza.
  const menuItem = catalog.menuItems.find((item) => String(item.id) === menuItemId);
  if (menuItem === undefined) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Pizza not found</h1>
        <p className="text-stone-600">That pizza isn&apos;t on our menu right now.</p>
        <BackToMenuLink />
      </section>
    );
  }

  const { sizes, crusts, toppings } = catalog;
  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{menuItem.name}</h1>
        {menuItem.description ? <p className="text-stone-600">{menuItem.description}</p> : null}
      </div>
      {isNonEmpty(sizes) && isNonEmpty(crusts) ? (
        <PizzaBuilderForm
          key={menuItem.id}
          menuItem={menuItem}
          sizes={sizes}
          crusts={crusts}
          toppings={toppings}
        />
      ) : (
        // Size and crust are required, so without both the pizza cannot be built.
        <EmptyState title="This pizza can't be ordered right now">
          <p>Please check back soon.</p>
          <p className="mt-3">
            <BackToMenuLink />
          </p>
        </EmptyState>
      )}
    </section>
  );
}

interface BuilderCatalog {
  menuItems: MenuItem[];
  sizes: Size[];
  crusts: Crust[];
  toppings: Topping[];
}

/** The four customer catalog lists, requested together. Any failure fails the load. */
async function loadCatalog(signal: AbortSignal): Promise<BuilderCatalog> {
  const [menuItems, sizes, crusts, toppings] = await Promise.all([
    getMenuItems({ signal }),
    getSizes({ signal }),
    getCrusts({ signal }),
    getToppings({ signal }),
  ]);
  return { menuItems, sizes, crusts, toppings };
}

function isNonEmpty<T>(list: readonly T[]): list is NonEmptyList<T> {
  return list.length > 0;
}

function BackToMenuLink() {
  return (
    <Link to="/" className="font-medium text-orange-700 hover:underline">
      Back to the menu
    </Link>
  );
}
