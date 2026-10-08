import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  API_URL: 'http://localhost:4000',
  WEB_URL: 'http://localhost:3000',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 4000,
      AUTH_DEV_LOGIN: false,
      SESSION_TTL_DAYS: 30,
    });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it('treats empty strings as unset', () => {
    const env = loadEnv({ ...base, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: ' ' });
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.GOOGLE_CLIENT_SECRET).toBeUndefined();
  });

  it('treats empty AI settings as unset', () => {
    const env = loadEnv({ ...base, AI_PROVIDER: '', ANTHROPIC_API_KEY: '', AI_MODEL: '' });
    expect(env.AI_PROVIDER).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.AI_MODEL).toBeUndefined();
    expect(env.EMBEDDING_MODEL).toBe('voyage-4-lite');
  });

  it.each([
    [{ AI_PROVIDER: 'groq' }, /AI_API_KEY/],
    [{ AI_PROVIDER: 'anthropic' }, /ANTHROPIC_API_KEY/],
    [{ AI_PROVIDER: 'openai-compatible', AI_MODEL: 'm' }, /AI_BASE_URL/],
    [{ AI_PROVIDER: 'openai-compatible', AI_BASE_URL: 'http://localhost:11434/v1' }, /AI_MODEL/],
    [{ AI_API_KEY: 'gsk_x' }, /AI_PROVIDER/],
    [{ AI_PROVIDER: 'grok', AI_API_KEY: 'x' }, /AI_PROVIDER/],
  ])('says what an AI provider is missing: %o', (overrides, message) => {
    expect(() => loadEnv({ ...base, ...overrides })).toThrow(message);
  });

  it('fails fast on missing required values', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('requires Google credentials to be set together', () => {
    expect(() => loadEnv({ ...base, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('refuses dev login in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', AUTH_DEV_LOGIN: 'true' })).toThrow(
      /AUTH_DEV_LOGIN/,
    );
  });

  it('refuses dev login on a non-localhost API even without NODE_ENV', () => {
    expect(() =>
      loadEnv({ ...base, API_URL: 'https://api.example.com', AUTH_DEV_LOGIN: 'true' }),
    ).toThrow(/AUTH_DEV_LOGIN/);
    expect(loadEnv({ ...base, AUTH_DEV_LOGIN: 'true' }).AUTH_DEV_LOGIN).toBe(true);
  });
});
