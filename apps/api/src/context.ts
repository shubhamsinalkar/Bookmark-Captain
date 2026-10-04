import type { Database } from '@bc/db';
import type { Logger } from 'pino';
import type { Env } from './config/env';
import { createEventBus, type EventBus } from './lib/event-bus';
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
  /** Null when Google sign-in is not configured. */
  google: GoogleOAuthConfig | null;
}

export function createContext({
  env,
  logger,
  db,
}: Pick<AppContext, 'env' | 'logger' | 'db'>): AppContext {
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
    google,
  };
}
