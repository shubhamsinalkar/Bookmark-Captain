import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export const AI_PROVIDERS = ['anthropic', 'groq', 'openai-compatible'] as const;
export type AiProviderName = (typeof AI_PROVIDERS)[number];

/** What each provider needs, as [variable, reason] pairs checked by the schema below. */
const AI_PROVIDER_REQUIREMENTS: Record<
  AiProviderName,
  ['ANTHROPIC_API_KEY' | 'AI_API_KEY' | 'AI_BASE_URL' | 'AI_MODEL', string][]
> = {
  anthropic: [['ANTHROPIC_API_KEY', 'AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY']],
  groq: [['AI_API_KEY', 'AI_PROVIDER=groq needs AI_API_KEY (from console.groq.com/keys)']],
  'openai-compatible': [
    ['AI_BASE_URL', 'AI_PROVIDER=openai-compatible needs AI_BASE_URL'],
    ['AI_MODEL', 'AI_PROVIDER=openai-compatible needs AI_MODEL'],
  ],
};

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.url(),

    API_URL: z.url(),
    WEB_URL: z.url(),
    COOKIE_DOMAIN: optionalString,
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    AUTH_DEV_LOGIN: z.stringbool().default(false),

    // AI enrichment: off unless a provider is configured (see `aiProvidersFromEnv`).
    // Without AI_PROVIDER, setting ANTHROPIC_API_KEY alone selects Claude.
    AI_PROVIDER: optionalString.pipe(z.enum(AI_PROVIDERS).optional()),
    ANTHROPIC_API_KEY: optionalString,
    /** Key for `groq` / `openai-compatible`. */
    AI_API_KEY: optionalString,
    AI_BASE_URL: optionalString.pipe(z.url().optional()),
    /** Defaults per provider. */
    AI_MODEL: optionalString,
    // Embeddings additionally need Voyage.
    VOYAGE_API_KEY: optionalString,
    EMBEDDING_MODEL: optionalString.transform((value) => value ?? 'voyage-4-lite'),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_SECRET'],
        message: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together',
      });
    }
    if (env.NODE_ENV === 'production' && env.AUTH_DEV_LOGIN) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_LOGIN'],
        message: 'Dev login must never be enabled in production',
      });
    }
    // Dev login signs anyone in as any email. NODE_ENV defaults to development, so don't rely
    // on it alone: a deployment that forgot to set it must still refuse.
    if (env.AUTH_DEV_LOGIN && !LOOPBACK_HOSTS.has(new URL(env.API_URL).hostname)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_DEV_LOGIN'],
        message: 'Dev login is only allowed when API_URL is a localhost address',
      });
    }
    if (env.AI_PROVIDER) {
      for (const [key, message] of AI_PROVIDER_REQUIREMENTS[env.AI_PROVIDER]) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message });
      }
    } else if (env.AI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'AI_API_KEY is set, so also set AI_PROVIDER (groq or openai-compatible)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses and validates configuration. Throws with a readable report so the process fails fast. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
