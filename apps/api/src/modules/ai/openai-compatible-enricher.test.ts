import { describe, expect, it, vi } from 'vitest';
import type { EnrichmentInput } from './enricher';
import { createOpenAiCompatibleEnricher } from './openai-compatible-enricher';

const input: EnrichmentInput = {
  platform: 'reddit',
  url: 'https://www.reddit.com/r/PostgreSQL/comments/1/seq_scan/',
  title: 'Seq scan on 2M rows?? Index exists but planner ignores it',
  author: 'u/tired_dba',
  text: 'x'.repeat(10_000),
  metadata: {},
  savedAt: new Date('2026-10-01T12:00:00Z'),
};

const output = {
  headline: 'Planner picks a seq scan over an existing index',
  summary: 'Replies point to selectivity, stale statistics and random_page_cost.',
  topics: ['postgres', 'query planning'],
  contentType: 'discussion',
  readMinutes: 6,
  shelfLife: 'evergreen',
};

const completion = (content: string | null, extra: Record<string, unknown> = {}) =>
  Response.json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content }, ...extra }],
  });

function groqReturning(response: Response, model = 'openai/gpt-oss-120b') {
  const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(response));
  const enricher = createOpenAiCompatibleEnricher({
    name: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: 'gsk_test',
    model,
    fetchImpl,
  });
  return { enricher, fetchImpl };
}

function sentBody(fetchImpl: ReturnType<typeof groqReturning>['fetchImpl']) {
  const [url, init] = fetchImpl.mock.calls[0]!;
  return {
    url: (url as URL).href,
    headers: init!.headers as Record<string, string>,
    body: JSON.parse(init!.body as string) as Record<string, unknown> & {
      messages: { role: string; content: string }[];
      response_format: { json_schema: { strict: boolean; schema: Record<string, unknown> } };
    },
  };
}

describe('createOpenAiCompatibleEnricher', () => {
  it('asks Groq for strict JSON and returns the normalised card', async () => {
    const { enricher, fetchImpl } = groqReturning(completion(JSON.stringify(output)));

    expect(enricher.model).toBe('groq/openai/gpt-oss-120b');
    await expect(enricher.enrich(input)).resolves.toEqual(output);

    const { url, headers, body } = sentBody(fetchImpl);
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer gsk_test');
    expect(body).toMatchObject({ model: 'openai/gpt-oss-120b', reasoning_effort: 'low' });
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);

    const { strict, schema } = body.response_format.json_schema;
    expect(strict).toBe(true);
    expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
    expect(schema.required).toEqual(Object.keys(output));
    // Strict validators reject these; zod adds them for integers.
    expect(JSON.stringify(schema)).not.toMatch(/\$schema|minimum|maximum/);
  });

  it('keeps long posts under free-tier token limits', async () => {
    const { enricher, fetchImpl } = groqReturning(completion(JSON.stringify(output)));
    await enricher.enrich(input);
    const userMessage = sentBody(fetchImpl).body.messages[1]!.content;
    expect(userMessage).toContain('… [truncated]');
    expect(userMessage.length).toBeLessThan(7000);
  });

  it('sends no reasoning setting to models without one, and no key when there is none', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(completion(JSON.stringify(output))),
    );
    await createOpenAiCompatibleEnricher({
      name: 'localhost',
      baseUrl: 'http://localhost:11434/v1/',
      model: 'qwen3:4b',
      fetchImpl,
    }).enrich(input);
    const { url, headers, body } = sentBody(fetchImpl);
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(headers).not.toHaveProperty('authorization');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it.each([
    [
      'a per-day quota (429)',
      new Response('{}', { status: 429, headers: { 'retry-after': '3600' } }),
      { kind: 'service', retryAfterMs: 3_600_000 },
    ],
    [
      'a rejected key (401)',
      new Response('{}', { status: 401 }),
      { kind: 'service', retryAfterMs: 600_000 },
    ],
    ['an unknown model (404)', new Response('{}', { status: 404 }), { kind: 'service' }],
    [
      'an outage (503)',
      new Response('{}', { status: 503 }),
      { kind: 'service', retryAfterMs: 60_000 },
    ],
    ['a request too large (413)', new Response('{}', { status: 413 }), { kind: 'refused' }],
    [
      'output that failed the schema (400)',
      Response.json(
        { error: { message: 'Generated JSON does not match the expected schema' } },
        { status: 400 },
      ),
      { kind: 'item', message: expect.stringContaining('does not match') as unknown },
    ],
    ['a cut-off answer', completion('{"headline":', { finish_reason: 'length' }), { kind: 'item' }],
    [
      'a refusal',
      Response.json({ choices: [{ message: { content: null, refusal: 'No.' } }] }),
      { kind: 'refused' },
    ],
  ])('classifies %s', async (_name, response, expected) => {
    const { enricher } = groqReturning(response);
    await expect(enricher.enrich(input)).rejects.toMatchObject(expected);
  });

  it('treats an unreachable server as a service problem', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('fetch failed')));
    const enricher = createOpenAiCompatibleEnricher({
      name: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: 'k',
      model: 'm',
      fetchImpl,
    });
    await expect(enricher.enrich(input)).rejects.toMatchObject({ kind: 'service' });
  });
});
