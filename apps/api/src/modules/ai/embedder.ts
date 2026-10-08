import { EMBEDDING_DIMENSIONS } from '@bc/db';
import { z } from 'zod';
import { AiError, retryAfterMs } from './ai-error';

export interface Embedder {
  readonly model: string;
  /**
   * One vector per text, in order. `document` for what gets stored, `query` for search input:
   * the model encodes them slightly differently so that questions land near their answers.
   * Throws `AiError` (always `service`: a failure affects the whole batch).
   */
  embed(
    texts: string[],
    inputType: 'document' | 'query',
    signal?: AbortSignal,
  ): Promise<number[][]>;
}

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const REQUEST_TIMEOUT_MS = 30_000;

const responseSchema = z.object({
  data: z.array(z.object({ index: z.number().int(), embedding: z.array(z.number()) })),
});

/** Voyage AI embeddings (https://docs.voyageai.com/reference/embeddings-api). */
export function createVoyageEmbedder({
  apiKey,
  model,
  fetchImpl = fetch,
}: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Embedder {
  return {
    model,

    async embed(texts, inputType, signal) {
      if (texts.length === 0) return [];
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetchImpl(VOYAGE_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            input: texts,
            model,
            input_type: inputType,
            output_dimension: EMBEDDING_DIMENSIONS,
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new AiError('service', `Voyage API unreachable: ${String(error)}`);
      }

      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        const pauseMs =
          response.status === 429
            ? retryAfterMs(response.headers, 60_000)
            : response.status >= 500
              ? 60_000
              : 10 * 60_000; // A bad key or model won't fix itself quickly.
        throw new AiError('service', `Voyage API error ${response.status}: ${detail}`, pauseMs);
      }

      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      const vectors = parsed.success
        ? parsed.data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding)
        : [];
      if (
        vectors.length !== texts.length ||
        vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)
      ) {
        throw new AiError(
          'service',
          `Voyage returned unexpected embeddings (is "${model}" a ${EMBEDDING_DIMENSIONS}-dimension model?)`,
          10 * 60_000,
        );
      }
      return vectors;
    },
  };
}
