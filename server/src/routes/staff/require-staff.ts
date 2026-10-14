import type { RequestHandler } from 'express';

/**
 * Access-control hook for all staff routes. The MVP has no staff login
 * (docs/PROJECT_MANIFEST.md Constraints), so it lets every request through;
 * adding real checks later only touches this middleware.
 */
export const requireStaff: RequestHandler = (_req, _res, next) => {
  next();
};
