import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { AiError, retryAfterMs } from './ai-error';
import {
  describeBookmark,
  ENRICHMENT_SYSTEM_PROMPT,
  type Enricher,
  enrichmentOutputSchema,
  parseEnrichment,
} from './enricher';

// Passed to `create()` (not `parse()`), so stop reasons are checked before the JSON is parsed.
const OUTPUT_FORMAT = betaZodOutputFormat(enrichmentOutputSchema);

const MAX_TOKENS = 4000;

/** Models that accept server-side refusal fallbacks (`fallbacks: 'default'`). */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);

/** Maps SDK errors onto what the worker should do; anything else is returned untouched. */
function classify(error: unknown, model: string): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError(
      'service',
      'Rate limited by the Anthropic API',
      retryAfterMs(error.headers, 60_000),
    );
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AiError('service', 'ANTHROPIC_API_KEY was rejected', 10 * 60_000);
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError('service', `Model "${model}" is not available`, 10 * 60_000);
  }
  // Includes timeouts and overload. The SDK has already retried these a couple of times.
  if (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new AiError('service', `Anthropic API unavailable: ${error.message}`);
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError('item', `Anthropic API error: ${error.message}`);
  }
  return error;
}

export function createClaudeEnricher({
  client,
  model,
}: {
  client: Anthropic;
  model: string;
}): Enricher {
  // Haiku has no effort setting; on larger models, low effort is plenty for labelling.
  const effort = model.startsWith('claude-haiku') ? {} : { effort: 'low' as const };
  const fallbacks = FALLBACK_MODELS.has(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
    : {};

  return {
    model,

    async enrich(input, signal) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create(
          {
            model,
            max_tokens: MAX_TOKENS,
            system: ENRICHMENT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: describeBookmark(input) }],
            output_config: { format: OUTPUT_FORMAT, ...effort },
            // On a safety decline, let the API retry on a suitable model instead of failing.
            ...fallbacks,
          },
          { signal },
        );
      } catch (error) {
        throw classify(error, model);
      }

      if (response.stop_reason === 'refusal') {
        throw new AiError('refused', 'The model declined to describe this bookmark');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AiError('item', 'The response was cut off');
      }
      const text = response.content.find((block) => block.type === 'text')?.text;
      if (!text) throw new AiError('item', 'The response had no text');
      return parseEnrichment(text);
    },
  };
}
