import type { Database } from '@bc/db';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import { createEventBus, type EventBus } from './lib/event-bus';
import { createEnrichmentService, type EnrichmentService } from './modules/ai/enrichment.service';
import { aiProvidersFromEnv, type ConfiguredAi } from './modules/ai/providers';
import { createSearchService, type SearchService } from './modules/ai/search.service';
import {
  type ApiTokenService,
  createApiTokenService,
} from './modules/api-tokens/api-token.service';
import type { GoogleOAuthConfig } from './modules/auth/google';
import { createSessionService, type SessionService } from './modules/auth/session.service';
import { type BookmarkService, createBookmarkService } from './modules/bookmarks/bookmark.service';
import { createUserRepository, type UserRepository } from './modules/users/user.repository';

/** Everything route handlers depend on, wired once at startup (and swapped in tests). */
export interface AppContext {
  env: Env;
  logger: Logger;
  db: Database;
  events: EventBus;
  sessions: SessionService;
  apiTokens: ApiTokenService;
  users: UserRepository;
  bookmarks: BookmarkService;
  /** Null when no AI provider is configured. */
  enrichment: EnrichmentService | null;
  /** Search by meaning; null without an embedding provider (VOYAGE_API_KEY). */
  search: SearchService | null;
  /** Null when Google sign-in is not configured. */
  google: GoogleOAuthConfig | null;
}

export function createContext({
  env,
  logger,
  db,
  ai = aiProvidersFromEnv(env),
}: Pick<AppContext, 'env' | 'logger' | 'db'> & {
  /** AI providers; defaults to the ones configured in `env`. Tests pass fakes. */
  ai?: ConfiguredAi | null;
}): AppContext {
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: new URL('/auth/google/callback', env.API_URL).toString(),
        }
      : null;
  const events = createEventBus();

  return {
    env,
    logger,
    db,
    events,
    sessions: createSessionService(db, env.SESSION_TTL_DAYS),
    apiTokens: createApiTokenService(db),
    users: createUserRepository(db),
    bookmarks: createBookmarkService(db, events),
    enrichment: ai?.enricher
      ? createEnrichmentService(db, events, logger, {
          enricher: ai.enricher,
          embedder: ai.embedder,
        })
      : null,
    search: ai?.embedder ? createSearchService(db, ai.embedder) : null,
    google,
  };
}
