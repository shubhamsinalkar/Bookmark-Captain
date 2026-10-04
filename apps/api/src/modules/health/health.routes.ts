import { sql } from 'drizzle-orm';
import { Router } from 'express';
import type { AppContext } from '../../context';

export function createHealthRouter({ db }: AppContext): Router {
  const router = Router();

  /**
   * Liveness: the process is up. Point platform health checks here. It never touches
   * the database, so frequent probes don't keep a Neon compute awake.
   */
  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /** Readiness: the process can serve traffic, including reaching the database. */
  router.get('/readyz', async (req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.json({ status: 'ok' });
    } catch (error) {
      req.log.error({ err: error }, 'Readiness check failed');
      res.status(503).json({ status: 'unavailable' });
    }
  });

  return router;
}
