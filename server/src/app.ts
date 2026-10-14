import express from 'express';
import type { Express } from 'express';
import type { AppDependencies } from './app-dependencies';
import { errorHandler, notFoundHandler } from './http/errors';
import { createCatalogRouter } from './routes/catalog';
import { createHealthRouter } from './routes/health';
import { createOrdersRouter } from './routes/orders';
import { createStaffRouter } from './routes/staff';

/**
 * Builds the Express app. Every router the MVP needs is already mounted here,
 * so feature work fills in its own router file instead of editing this one
 * (ADR 0001 rule 10).
 */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', createHealthRouter(deps));
  app.use('/api', createCatalogRouter(deps));
  app.use('/api', createOrdersRouter(deps));
  app.use('/api/staff', createStaffRouter(deps));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
