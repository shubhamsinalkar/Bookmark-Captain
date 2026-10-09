import Anthropic from '@anthropic-ai/sdk';
import type { AiProviderName, Env } from '../../config/env';
import { createClaudeEnricher } from './claude-enricher';
import { createVoyageEmbedder, type Embedder } from './embedder';
import type { Enricher } from './enricher';
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

/**
 * Summaries and embeddings are configured independently: search by meaning keeps working
 * with only VOYAGE_API_KEY (over what's already embedded), e.g. with summaries switched off
 * to save a free tier's quota.
 */
export interface ConfiguredAi {
  enricher: Enricher | null;
  embedder: Embedder | null;
}

/** The AI providers configured in `env`, or null when there are none. */
export function aiProvidersFromEnv(env: Env): ConfiguredAi | null {
  const enricher = enricherFromEnv(env);
  const embedder = env.VOYAGE_API_KEY
    ? createVoyageEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL })
    : null;
  return enricher || embedder ? { enricher, embedder } : null;
}
