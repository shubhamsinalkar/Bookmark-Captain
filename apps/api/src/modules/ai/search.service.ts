import { bookmarkEmbeddings, type BookmarkRow, bookmarks, type Database } from '@bc/db';
import type { searchByMeaningQuerySchema } from '@bc/shared';
import { and, cosineDistance, count, eq, lte, not, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { viewCondition, wordMatchCondition } from '../bookmarks/bookmark.service';
import type { Embedder } from './embedder';

type SearchQuery = z.output<typeof searchByMeaningQuerySchema>;

/**
 * Cut-offs, tuned on voyage-4-lite with real bookmarks: related items score roughly 0.3–0.6
 * and unrelated ones about 0.2. Results must clear the floor, and also stay within reach of the
 * best match, so a strong hit doesn't come with a tail of weak ones.
 */
const MIN_SIMILARITY = 0.25;
const RELATIVE_TO_BEST = 0.6;
/** Typing and live refreshes repeat queries; each embedding is a rate-limited API call. */
const QUERY_CACHE_SIZE = 200;

export interface SearchMatches {
  matches: { row: BookmarkRow; similarity: number }[];
  /** The user's bookmarks with a vector from the current model, out of all of them. */
  indexed: number;
  total: number;
}

/** Search by meaning over `bookmark_embeddings`. Throws `AiError` when embedding the query fails. */
export function createSearchService(db: Database, embedder: Embedder) {
  const queryVectors = new Map<string, number[]>();

  async function embedQuery(q: string): Promise<number[]> {
    const key = q.toLowerCase();
    const cached = queryVectors.get(key);
    if (cached) {
      // Re-insert so the Map's order works as least-recently-used.
      queryVectors.delete(key);
      queryVectors.set(key, cached);
      return cached;
    }
    const [vector] = await embedder.embed([q], 'query');
    queryVectors.set(key, vector!);
    if (queryVectors.size > QUERY_CACHE_SIZE) {
      queryVectors.delete(queryVectors.keys().next().value!);
    }
    return vector!;
  }

  return {
    async search(userId: string, query: SearchQuery): Promise<SearchMatches> {
      const vector = await embedQuery(query.q);
      const distance = cosineDistance(bookmarkEmbeddings.embedding, vector);
      const conditions: (SQL | undefined)[] = [
        eq(bookmarkEmbeddings.userId, userId),
        eq(bookmarkEmbeddings.model, embedder.model),
        lte(distance, 1 - MIN_SIMILARITY),
        viewCondition(query.view, new Date()),
      ];
      if (query.platform) conditions.push(eq(bookmarks.platform, query.platform));
      if (query.excludeWordMatches) conditions.push(not(wordMatchCondition(query.q)));

      const [rows, [indexed], [total]] = await Promise.all([
        db
          .select({ row: bookmarks, similarity: sql<number>`1 - (${distance})` })
          .from(bookmarkEmbeddings)
          .innerJoin(bookmarks, eq(bookmarks.id, bookmarkEmbeddings.bookmarkId))
          .where(and(...conditions))
          .orderBy(distance)
          .limit(query.limit),
        db
          .select({ n: count() })
          .from(bookmarkEmbeddings)
          .where(
            and(
              eq(bookmarkEmbeddings.userId, userId),
              eq(bookmarkEmbeddings.model, embedder.model),
            ),
          ),
        db.select({ n: count() }).from(bookmarks).where(eq(bookmarks.userId, userId)),
      ]);

      const best = rows[0] ? Number(rows[0].similarity) : 0;
      return {
        matches: rows
          .map(({ row, similarity }) => ({ row, similarity: Number(similarity) }))
          .filter(({ similarity }) => similarity >= best * RELATIVE_TO_BEST),
        indexed: indexed?.n ?? 0,
        total: total?.n ?? 0,
      };
    },
  };
}

export type SearchService = ReturnType<typeof createSearchService>;
