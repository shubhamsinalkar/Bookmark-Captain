import { createDb } from '@bc/db';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createContext } from './context';
import { createLogger } from './lib/logger';

const SHUTDOWN_TIMEOUT_MS = 10_000;

let env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = createLogger(env);
const { db, pool } = createDb({
  connectionString: env.DATABASE_URL,
  onPoolError: (error) => logger.warn({ err: error }, 'Idle database connection error'),
});
const ctx = createContext({ env, logger, db });
const app = createApp(ctx);

const server = app.listen(env.PORT, (error) => {
  if (error) {
    logger.fatal({ err: error }, 'Failed to start HTTP server');
    process.exit(1);
  }
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
});
// Keep idle connections open longer than typical load balancers (60s) to avoid 502s.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;

let shuttingDown = false;

function shutdown(reason: string, exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, 'Shutting down');

  setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // Stop accepting connections, let in-flight requests finish, then release the pool.
  server.close((error) => {
    if (error) logger.error({ err: error }, 'Error while closing HTTP server');
    pool
      .end()
      .catch((poolError: unknown) => logger.error({ err: poolError }, 'Error closing DB pool'))
      .finally(() => process.exit(error ? 1 : exitCode));
  });
  // Event streams never finish on their own; end them so in-flight requests can drain.
  ctx.events.closeAllConnections();
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  shutdown('unhandledRejection', 1);
});
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  shutdown('uncaughtException', 1);
});
