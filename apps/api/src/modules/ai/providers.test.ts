import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env';
import { aiProvidersFromEnv } from './providers';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_URL: 'http://localhost:4000',
  WEB_URL: 'http://localhost:3000',
};

const providers = (env: Record<string, string>) => aiProvidersFromEnv(loadEnv({ ...base, ...env }));

describe('aiProvidersFromEnv', () => {
  it('is off without any AI configuration', () => {
    expect(providers({})).toBeNull();
    expect(providers({ VOYAGE_API_KEY: 'pa-x' })).toBeNull();
  });

  it('picks Claude from ANTHROPIC_API_KEY alone, as before', () => {
    expect(providers({ ANTHROPIC_API_KEY: 'sk-ant-x' })?.enricher.model).toBe('claude-opus-5-5');
  });

  it('uses Groq with its default free model', () => {
    const result = providers({ AI_PROVIDER: 'groq', AI_API_KEY: 'gsk_x' });
    expect(result?.enricher.model).toBe('groq/openai/gpt-oss-120b');
    expect(result?.embedder).toBeNull();
  });

  it('adds Voyage embeddings next to any provider', () => {
    const result = providers({ AI_PROVIDER: 'groq', AI_API_KEY: 'gsk_x', VOYAGE_API_KEY: 'pa-x' });
    expect(result?.embedder?.model).toBe('voyage-4-lite');
  });

  it('names a generic provider after its host', () => {
    const result = providers({
      AI_PROVIDER: 'openai-compatible',
      AI_BASE_URL: 'http://localhost:11434/v1',
      AI_MODEL: 'qwen3:4b',
    });
    expect(result?.enricher.model).toBe('localhost/qwen3:4b');
  });
});
