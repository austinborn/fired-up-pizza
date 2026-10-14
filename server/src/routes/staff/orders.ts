import { Router } from 'express';
import type { AppDependencies } from '../../app-dependencies';

/**
 * Staff order queue, mounted at /api/staff (ADR 0006):
 *   GET   /api/staff/orders             live orders, oldest first
 *   PATCH /api/staff/orders/:id/status  advance or cancel via the transition service
 * Stub until the staff orders API work item fills it in.
 */
export function createStaffOrdersRouter(_deps: AppDependencies): Router {
  return Router();
}
