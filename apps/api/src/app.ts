import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { originCheck } from './middleware/origin-check';
import { createRateLimiter } from './middleware/rate-limit';
import { createApiTokensRouter } from './modules/api-tokens/api-tokens.routes';
import { createAuthRouter } from './modules/auth/auth.routes';
import { createBookmarksRouter } from './modules/bookmarks/bookmarks.routes';
import { createEventsRouter } from './modules/events/events.routes';
import { createHealthRouter } from './modules/health/health.routes';
import { createUsersRouter } from './modules/users/users.routes';

const REQUEST_ID_HEADER = 'x-request-id';

export function createApp(ctx: AppContext): Express {
  const { env, logger } = ctx;
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/healthz' },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.WEB_URL, credentials: true, maxAge: 600 }));
  // Bulk ingest batches can be large; every other route keeps the tighter limit.
  // (express.json skips bodies that an earlier parser already handled.)
  app.use('/bookmarks/ingest', express.json({ limit: '5mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(originCheck([env.WEB_URL, env.API_URL]));

  app.use(createHealthRouter(ctx));
  app.use(createRateLimiter({ windowMs: 60_000, limit: 300 }));
  app.use('/auth', createAuthRouter(ctx));
  app.use('/api-tokens', createApiTokensRouter(ctx));
  app.use('/bookmarks', createBookmarksRouter(ctx));
  app.use(createEventsRouter(ctx));
  app.use(createUsersRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
