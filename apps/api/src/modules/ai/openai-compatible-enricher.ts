import { z } from 'zod';
import { AiError, retryAfterMs } from './ai-error';
import {
  type DescribeOptions,
  describeBookmark,
  ENRICHMENT_SYSTEM_PROMPT,
  type Enricher,
  enrichmentOutputSchema,
  parseEnrichment,
} from './enricher';

/**
 * Enrichment through any OpenAI-compatible Chat Completions API: Groq, Gemini, OpenRouter,
 * Ollama and others. The model must support structured outputs (`json_schema`, strict).
 */

const REQUEST_TIMEOUT_MS = 60_000;
/** Room for a reasoning model's thinking plus the JSON answer. */
const MAX_COMPLETION_TOKENS = 2000;
/**
 * Free tiers cap tokens per minute (Groq: 8K), and a request over the cap can never succeed.
 * ~6,000 characters is ~1,500 tokens: plenty to summarise from.
 */
const INPUT_LIMITS: DescribeOptions = { maxTextChars: 6000, maxMetadataChars: 1000 };

/** Removes what strict-mode validators reject: `$schema`, and zod's safe-integer bounds. */
function toStrictSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toStrictSchema);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== '$schema' && key !== 'minimum' && key !== 'maximum')
      .map(([key, child]) => [key, toStrictSchema(child)]),
  );
}

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'bookmark_card',
    strict: true,
    schema: toStrictSchema(z.toJSONSchema(enrichmentOutputSchema)),
  },
};

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({ content: z.string().nullish(), refusal: z.string().nullish() }),
      }),
    )
    .min(1),
});

async function errorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === 'string') return parsed.error.message.slice(0, 300);
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return body.slice(0, 300);
}

export function createOpenAiCompatibleEnricher({
  name,
  baseUrl,
  apiKey,
  model,
  fetchImpl = fetch,
}: {
  /** Provider name for logs and error messages, e.g. "groq". */
  name: string;
  baseUrl: string;
  /** Optional: local servers such as Ollama need none. */
  apiKey?: string | undefined;
  model: string;
  fetchImpl?: typeof fetch;
}): Enricher {
  const url = new URL('chat/completions', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  // gpt-oss models think before answering; a label needs little of it, and thinking tokens
  // count against free-tier token limits.
  const reasoning = model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {};

  return {
    model: `${name}/${model}`,

    async enrich(input, signal) {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey && { authorization: `Bearer ${apiKey}` }),
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: ENRICHMENT_SYSTEM_PROMPT },
              { role: 'user', content: describeBookmark(input, INPUT_LIMITS) },
            ],
            response_format: RESPONSE_FORMAT,
            max_completion_tokens: MAX_COMPLETION_TOKENS,
            ...reasoning,
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new AiError('service', `${name} unreachable: ${String(error)}`);
      }

      if (!response.ok) {
        const detail = await errorDetail(response);
        const message = `${name} error ${response.status}: ${detail}`;
        switch (true) {
          case response.status === 429:
            // Per-minute and per-day quotas both land here; Retry-After says which.
            throw new AiError('service', message, retryAfterMs(response.headers, 60_000));
          case response.status === 401 || response.status === 403:
            throw new AiError('service', `AI_API_KEY was rejected by ${name}`, 10 * 60_000);
          case response.status === 404:
            throw new AiError('service', `Model "${model}" is not available`, 10 * 60_000);
          case response.status === 413:
            throw new AiError('refused', `Too long for ${model}`);
          case response.status >= 500:
            throw new AiError('service', message);
          default:
            // 400s include "output didn't match the schema", which a retry can fix.
            throw new AiError('item', message);
        }
      }

      const parsed = completionSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) throw new AiError('item', `${name} returned an unexpected response`);
      const { message, finish_reason } = parsed.data.choices[0]!;
      if (message.refusal) throw new AiError('refused', `The model declined: ${message.refusal}`);
      if (finish_reason === 'length') throw new AiError('item', 'The response was cut off');
      if (!message.content) throw new AiError('item', 'The response had no text');
      return parseEnrichment(message.content);
    },
  };
}
