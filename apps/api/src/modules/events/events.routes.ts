import type { ServerEvent } from '@bc/shared';
import { Router } from 'express';
import type { AppContext } from '../../context';
import { getAuthUser, requireAuth } from '../../middleware/require-auth';

/** Comment lines keep proxies and load balancers from closing an idle stream. */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** Tells EventSource how long to wait before reconnecting after a drop. */
const RECONNECT_DELAY_MS = 5_000;

export function createEventsRouter(ctx: AppContext): Router {
  const router = Router();

  /** Server-sent events: pushes change notifications so open tabs update without polling. */
  router.get('/events', requireAuth(ctx), (req, res) => {
    const userId = getAuthUser(req).id;

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable response buffering in nginx-style proxies.
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();

    const send = (event: ServerEvent) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    res.write(`retry: ${RECONNECT_DELAY_MS}\n\n`);
    send({ type: 'ready' });

    const unsubscribe = ctx.events.subscribe(userId, send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_INTERVAL_MS);
    const untrack = ctx.events.trackConnection(() => res.end());

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      untrack();
    });
  });

  return router;
}
