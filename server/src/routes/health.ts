import { Router } from 'express';
import type { AppDependencies } from '../app-dependencies';

export interface HealthResponse {
  status: 'ok';
}

/** GET /api/health: process is up and the database answers. */
export function createHealthRouter({ db }: AppDependencies): Router {
  const router = Router();
  const ping = db.prepare('SELECT 1');

  router.get('/health', (_req, res) => {
    ping.get();
    const body: HealthResponse = { status: 'ok' };
    res.json(body);
  });

  return router;
}
