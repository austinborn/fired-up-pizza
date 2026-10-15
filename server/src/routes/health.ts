import { Router } from 'express';
import type { AppDependencies } from '../app-dependencies';
import { createDatabasePing } from '../db/connection';

export interface HealthResponse {
  status: 'ok';
}

/**
 * GET /api/health: process is up and the database answers. The SQL lives in
 * db/ (ADR 0002 rule 5), so the handler only calls it and responds (ADR 0006 rule 7).
 */
export function createHealthRouter({ db }: AppDependencies): Router {
  const router = Router();
  const pingDatabase = createDatabasePing(db);

  router.get('/health', (_req, res) => {
    pingDatabase();
    const body: HealthResponse = { status: 'ok' };
    res.json(body);
  });

  return router;
}
