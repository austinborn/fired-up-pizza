import { Router } from 'express';
import type { AppDependencies } from '../../app-dependencies';
import { createStaffCatalogRouter } from './catalog';
import { createStaffOrdersRouter } from './orders';
import { requireStaff } from './require-staff';

/**
 * Every staff endpoint lives under /api/staff and passes through requireStaff,
 * the single place access control will be added (ADR 0006 rule 3).
 */
export function createStaffRouter(deps: AppDependencies): Router {
  const router = Router();
  router.use(requireStaff);
  router.use(createStaffOrdersRouter(deps));
  router.use(createStaffCatalogRouter(deps));
  return router;
}
