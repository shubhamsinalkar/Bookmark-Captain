/** Tag shared by the X network tap and the X content script. */
export const X_TAP_TAG = 'x';

const GRAPHQL_PATH = /\/i\/api\/graphql\/[\w-]+\/(\w+)/;

/**
 * X's web app loads everything through GraphQL at `/i/api/graphql/<queryId>/<Operation>`.
 * The query id changes with every X deployment; the operation name ("Bookmarks",
 * "CreateBookmark", "HomeTimeline", …) is stable, so that is what we key on.
 */
export function graphqlOperation(url: string): string | null {
  return GRAPHQL_PATH.exec(url)?.[1] ?? null;
}

/** The saved-posts list. */
export const X_BOOKMARKS_PATH = '/i/bookmarks';
