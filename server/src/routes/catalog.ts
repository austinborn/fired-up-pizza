import { Router } from 'express';
import type { AppDependencies } from '../app-dependencies';

/**
 * Customer catalog, mounted at /api (ADR 0006):
 *   GET /api/menu-items, GET /api/sizes, GET /api/crusts, GET /api/toppings
 * Stub until the catalog API work item fills it in.
 */
export function createCatalogRouter(_deps: AppDependencies): Router {
  return Router();
}
