/**
 * Where a bookmark came from. Two kinds of id:
 *  - a known platform ("x", "instagram", …): first-class name and flag, and for some a
 *    built-in connector;
 *  - any other site the user connects: its domain, e.g. "pinterest.com".
 *
 * Zod-free on purpose: re-exported through `@bc/shared/constants` for the extension.
 */

export const KNOWN_PLATFORMS = [
  'browser',
  'x',
  'instagram',
  'linkedin',
  'reddit',
  'youtube',
  'github',
  'manual',
] as const;
export type KnownPlatform = (typeof KNOWN_PLATFORMS)[number];

/** A known platform id or a site's domain. (The `string & {}` keeps editor autocompletion.) */
export type Platform = KnownPlatform | (string & {});

export const PLATFORM_LABELS: Record<KnownPlatform, string> = {
  browser: 'Browser',
  x: 'X',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  reddit: 'Reddit',
  youtube: 'YouTube',
  github: 'GitHub',
  manual: 'Added manually',
};

/** Sites that belong to a known platform (after dropping www./m./mobile.). */
const KNOWN_DOMAINS: Record<string, KnownPlatform> = {
  'x.com': 'x',
  'twitter.com': 'x',
  'instagram.com': 'instagram',
  'linkedin.com': 'linkedin',
  'reddit.com': 'reddit',
  'old.reddit.com': 'reddit',
  'youtube.com': 'youtube',
  'github.com': 'github',
};

const DOMAIN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/;

const knownSet: ReadonlySet<string> = new Set(KNOWN_PLATFORMS);

export function isKnownPlatform(value: string): value is KnownPlatform {
  return knownSet.has(value);
}

/** A valid platform id: a known platform or a lowercase domain. */
export function isPlatformId(value: string): boolean {
  return isKnownPlatform(value) || DOMAIN.test(value);
}

/** The platform for a site's hostname, e.g. "www.instagram.com" → "instagram". */
export function platformForHost(hostname: string): Platform {
  const host = hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  return KNOWN_DOMAINS[host] ?? host;
}

/** Display name: "Instagram" for known platforms, the domain itself for other sites. */
export function platformLabel(platform: Platform): string {
  return isKnownPlatform(platform) ? PLATFORM_LABELS[platform] : platform;
}
