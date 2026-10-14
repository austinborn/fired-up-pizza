import { Router } from 'express';
import type { AppDependencies } from '../app-dependencies';

/**
 * Customer orders, mounted at /api (ADR 0006):
 *   POST /api/orders           place an order (place-order work item)
 *   GET  /api/orders?phone=... look up a phone's orders (order lookup work item)
 */
export function createOrdersRouter(_deps: AppDependencies): Router {
  return Router();
}
