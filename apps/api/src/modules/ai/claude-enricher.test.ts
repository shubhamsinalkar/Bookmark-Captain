import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AiError } from './ai-error';
import { createClaudeEnricher } from './claude-enricher';
import type { EnrichmentInput } from './enricher';

const input: EnrichmentInput = {
  platform: 'x',
  url: 'https://x.com/dbnerd/status/1',
  title: "Your Postgres index isn't being used? 7 reasons why 🧵",
  author: '@dbnerd',
  text: '1/ Functions on the column…',
  metadata: {},
  savedAt: new Date('2026-10-01T12:00:00Z'),
};

const output = {
  headline: 'Why Postgres ignores your index',
  summary: 'Seven reasons: functions on columns, implicit casts, stale statistics, …',
  topics: ['postgres'],
  contentType: 'tutorial',
  readMinutes: 4,
  shelfLife: 'evergreen',
};

function fakeClient(respond: () => unknown) {
  const create = vi.fn(() => Promise.resolve(respond()));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const message = (text: string, stopReason = 'end_turn') => ({
  content: [{ type: 'text', text }],
  stop_reason: stopReason,
});

describe('createClaudeEnricher', () => {
  it('returns the structured output, asking for low effort and refusal fallbacks', async () => {
    const { client, create } = fakeClient(() => message(JSON.stringify(output)));
    const enricher = createClaudeEnricher({ client, model: 'claude-opus-5-5' });

    await expect(enricher.enrich(input)).resolves.toEqual(output);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-5-5',
        output_config: expect.objectContaining({
          effort: 'low',
          format: expect.objectContaining({ type: 'json_schema' }),
        }),
        fallbacks: 'default',
        betas: ['server-side-fallback-2026-07-01'],
      }),
      expect.anything(),
    );
  });

  it('leaves out options Haiku does not accept', async () => {
    const { client, create } = fakeClient(() => message(JSON.stringify(output)));
    await createClaudeEnricher({ client, model: 'claude-haiku-4-5' }).enrich(input);
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty('fallbacks');
    expect(params.output_config).not.toHaveProperty('effort');
  });

  it.each([
    ['a refusal', message('', 'refusal'), 'refused'],
    ['a truncated response', message('{"headline":', 'max_tokens'), 'item'],
    ['output that misses the schema', message('{"headline": "x"}'), 'item'],
  ])('classifies %s', async (_name, response, kind) => {
    const { client } = fakeClient(() => response);
    const promise = createClaudeEnricher({ client, model: 'claude-opus-5-5' }).enrich(input);
    await expect(promise).rejects.toBeInstanceOf(AiError);
    await expect(promise).rejects.toMatchObject({ kind });
  });

  it('pauses on rate limits for as long as the API asks', async () => {
    const { client } = fakeClient(() => {
      throw new Anthropic.RateLimitError(
        429,
        undefined,
        'rate limited',
        new Headers({ 'retry-after': '30' }),
      );
    });
    await expect(
      createClaudeEnricher({ client, model: 'claude-opus-5-5' }).enrich(input),
    ).rejects.toMatchObject({ kind: 'service', retryAfterMs: 30_000 });
  });

  it('treats a rejected key as a service problem, not the bookmark’s', async () => {
    const { client } = fakeClient(() => {
      throw new Anthropic.AuthenticationError(401, undefined, 'bad key', new Headers());
    });
    await expect(
      createClaudeEnricher({ client, model: 'claude-opus-5-5' }).enrich(input),
    ).rejects.toMatchObject({ kind: 'service', retryAfterMs: 600_000 });
  });
});
