import { Router } from 'express';
import type { AppDependencies } from '../../app-dependencies';

/**
 * Staff menu management, mounted at /api/staff (ADR 0006):
 *   GET/POST /api/staff/menu-items, PATCH /api/staff/menu-items/:id
 *   GET/POST /api/staff/toppings,   PATCH /api/staff/toppings/:id
 * Stub until the staff catalog API work item fills it in.
 */
export function createStaffCatalogRouter(_deps: AppDependencies): Router {
  return Router();
}
