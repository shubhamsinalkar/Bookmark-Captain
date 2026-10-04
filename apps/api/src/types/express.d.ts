import type { UserRow } from '@bc/db';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Read it through `getAuthUser(req)`. */
      auth?:
        | { method: 'session'; user: UserRow }
        /** An API token (e.g. the extension). */
        | { method: 'token'; user: UserRow; tokenId: string };
    }
  }
}

export {};
