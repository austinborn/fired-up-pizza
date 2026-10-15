import type { Crust, MenuItem, Size, Topping } from '@fired-up-pizza/shared';
import { Router } from 'express';
import type { AppDependencies } from '../app-dependencies';
import { createCatalogRepository } from '../repositories/catalog';

/**
 * Customer catalog, mounted at /api (ADR 0006 rule 2). Each endpoint returns a
 * JSON array of shared domain types:
 *   GET /api/menu-items  available menu items, by category, then name, ignoring case
 *   GET /api/sizes       every size, smallest price multiplier first
 *   GET /api/crusts      every crust, cheapest first, then by name
 *   GET /api/toppings    available toppings, by name, ignoring case
 *
 * The lists never ask the repository for hidden rows, and no query parameter
 * can change that. Hidden menu items and toppings reach only the staff catalog
 * under /api/staff.
 */
export function createCatalogRouter({ db }: AppDependencies): Router {
  const router = Router();
  const catalog = createCatalogRepository(db);

  router.get('/menu-items', (_req, res) => {
    const menuItems: MenuItem[] = catalog.listMenuItems();
    res.json(menuItems);
  });

  router.get('/sizes', (_req, res) => {
    const sizes: Size[] = catalog.listSizes();
    res.json(sizes);
  });

  router.get('/crusts', (_req, res) => {
    const crusts: Crust[] = catalog.listCrusts();
    res.json(crusts);
  });

  router.get('/toppings', (_req, res) => {
    const toppings: Topping[] = catalog.listToppings();
    res.json(toppings);
  });

  return router;
}
