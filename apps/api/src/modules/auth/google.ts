import { emailSchema } from '@bc/shared';
import { z } from 'zod';
import { sha256Base64Url } from '../../lib/tokens';
import type { GoogleProfile } from '../users/user.repository';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REQUEST_TIMEOUT_MS = 10_000;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GoogleAuthError extends Error {
  override name = 'GoogleAuthError';
}

const tokenResponseSchema = z.object({ id_token: z.string().min(1) });

const idTokenClaimsSchema = z.object({
  iss: z.enum(['https://accounts.google.com', 'accounts.google.com']),
  aud: z.string(),
  exp: z.number(),
  sub: z.string().min(1),
  email: z.string(),
  email_verified: z.boolean(),
  name: z.string().optional(),
  picture: z.url().optional(),
});

/** Builds the Google consent URL for the Authorization Code flow with PKCE (S256). */
export function buildAuthorizationUrl(
  config: GoogleOAuthConfig,
  { state, codeVerifier }: { state: string; codeVerifier: string },
): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: sha256Base64Url(codeVerifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

function decodeJwtPayload(jwt: string): unknown {
  const payload = jwt.split('.')[1];
  if (!payload) throw new GoogleAuthError('Malformed ID token');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/**
 * Exchanges the authorization code for tokens and returns the verified profile.
 *
 * The ID token is received directly from Google's token endpoint over TLS, so per
 * OIDC Core §3.1.3.7 its signature need not be re-checked. Issuer, audience, expiry
 * and email verification are still enforced.
 */
export async function exchangeCodeForProfile(
  config: GoogleOAuthConfig,
  { code, codeVerifier }: { code: string; codeVerifier: string },
): Promise<GoogleProfile> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new GoogleAuthError(`Token exchange failed with status ${response.status}`);
  }

  const { id_token: idToken } = tokenResponseSchema.parse(await response.json());
  const claims = idTokenClaimsSchema.parse(decodeJwtPayload(idToken));

  if (claims.aud !== config.clientId) throw new GoogleAuthError('ID token audience mismatch');
  if (claims.exp * 1000 <= Date.now()) throw new GoogleAuthError('ID token expired');
  if (!claims.email_verified) throw new GoogleAuthError('Google email is not verified');

  return {
    sub: claims.sub,
    email: emailSchema.parse(claims.email),
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}
