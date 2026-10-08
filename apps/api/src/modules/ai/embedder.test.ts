import { EMBEDDING_DIMENSIONS } from '@bc/db';
import { describe, expect, it, vi } from 'vitest';
import { createVoyageEmbedder } from './embedder';

const vector = (value: number) => Array<number>(EMBEDDING_DIMENSIONS).fill(value);

function embedderReturning(response: Response) {
  const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(response));
  return {
    fetchImpl,
    embedder: createVoyageEmbedder({ apiKey: 'k', model: 'voyage-4-lite', fetchImpl }),
  };
}

describe('createVoyageEmbedder', () => {
  it('returns vectors in input order', async () => {
    const { embedder, fetchImpl } = embedderReturning(
      Response.json({
        data: [
          { index: 1, embedding: vector(2) },
          { index: 0, embedding: vector(1) },
        ],
      }),
    );

    const vectors = await embedder.embed(['a', 'b'], 'document');
    expect(vectors.map((v) => v[0])).toEqual([1, 2]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(JSON.parse(init!.body as string)).toEqual({
      input: ['a', 'b'],
      model: 'voyage-4-lite',
      input_type: 'document',
      output_dimension: EMBEDDING_DIMENSIONS,
    });
  });

  it('skips the request for an empty batch', async () => {
    const { embedder, fetchImpl } = embedderReturning(Response.json({ data: [] }));
    await expect(embedder.embed([], 'query')).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pauses for Retry-After on rate limits', async () => {
    const { embedder } = embedderReturning(
      new Response('slow down', { status: 429, headers: { 'retry-after': '5' } }),
    );
    await expect(embedder.embed(['a'], 'document')).rejects.toMatchObject({
      kind: 'service',
      retryAfterMs: 5000,
    });
  });

  it('rejects vectors of the wrong size', async () => {
    const { embedder } = embedderReturning(
      Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }] }),
    );
    await expect(embedder.embed(['a'], 'document')).rejects.toMatchObject({
      kind: 'service',
      message: expect.stringContaining('1024-dimension') as unknown,
    });
  });
});
