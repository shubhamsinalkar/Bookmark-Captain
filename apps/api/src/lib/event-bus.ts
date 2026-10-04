import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@bc/shared';

type Listener = (event: ServerEvent) => void;

/**
 * In-process, per-user pub/sub feeding the server-sent events stream.
 *
 * Correct for a single API instance. Before running several replicas, back `publish` with a
 * shared channel (Redis pub/sub, or Postgres LISTEN/NOTIFY on a direct connection) so an
 * event raised on one instance reaches tabs connected to another.
 */
export function createEventBus() {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(0);
  const connections = new Set<() => void>();

  return {
    publish(userId: string, event: ServerEvent): void {
      emitter.emit(userId, event);
    },

    subscribe(userId: string, listener: Listener): () => void {
      emitter.on(userId, listener);
      return () => emitter.off(userId, listener);
    },

    /** Registers a long-lived connection so shutdown can close it; returns an unregister fn. */
    trackConnection(close: () => void): () => void {
      connections.add(close);
      return () => connections.delete(close);
    },

    /** Ends every open stream, so graceful shutdown isn't held up by idle SSE clients. */
    closeAllConnections(): void {
      for (const close of connections) close();
      connections.clear();
    },
  };
}

export type EventBus = ReturnType<typeof createEventBus>;
