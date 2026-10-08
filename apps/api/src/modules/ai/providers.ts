import Anthropic from '@anthropic-ai/sdk';
import type { AiProviderName, Env } from '../../config/env';
import { createClaudeEnricher } from './claude-enricher';
import { createVoyageEmbedder } from './embedder';
import type { Enricher } from './enricher';
import type { AiProviders } from './enrichment.service';
import { createOpenAiCompatibleEnricher } from './openai-compatible-enricher';

export const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  // Free tier; one of the Groq models with strict structured outputs.
  groq: 'openai/gpt-oss-120b',
} as const;

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** The configured provider: AI_PROVIDER, or Claude when only ANTHROPIC_API_KEY is set. */
export function aiProviderName(env: Env): AiProviderName | null {
  return env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : null);
}

// `loadEnv` has already checked that each provider's required variables are set.
function enricherFromEnv(env: Env): Enricher | null {
  switch (aiProviderName(env)) {
    case null:
      return null;
    case 'anthropic':
      return createClaudeEnricher({
        client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!, timeout: 60_000, maxRetries: 2 }),
        model: env.AI_MODEL ?? DEFAULT_MODELS.anthropic,
      });
    case 'groq':
      return createOpenAiCompatibleEnricher({
        name: 'groq',
        baseUrl: env.AI_BASE_URL ?? GROQ_BASE_URL,
        apiKey: env.AI_API_KEY,
        model: env.AI_MODEL ?? DEFAULT_MODELS.groq,
      });
    case 'openai-compatible':
      return createOpenAiCompatibleEnricher({
        name: new URL(env.AI_BASE_URL!).hostname,
        baseUrl: env.AI_BASE_URL!,
        apiKey: env.AI_API_KEY,
        model: env.AI_MODEL!,
      });
  }
}

/** AI providers configured in `env`, or null when enrichment is off. */
export function aiProvidersFromEnv(env: Env): AiProviders | null {
  const enricher = enricherFromEnv(env);
  if (!enricher) return null;
  return {
    enricher,
    embedder: env.VOYAGE_API_KEY
      ? createVoyageEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL })
      : null,
  };
}
