/**
 * URL normalisation used for de-duplication.
 *
 * `url` is what we open for the user (tracking parameters removed, otherwise untouched).
 * `canonicalUrl` is a stable identity key: two links to the same resource should produce
 * the same canonical URL even when shared from different apps.
 */

export class InvalidUrlError extends Error {
  override name = 'InvalidUrlError';
}

export interface NormalizedUrl {
  url: string;
  canonicalUrl: string;
}

/** Query parameters that only carry attribution/tracking data, on any site. */
const GLOBAL_TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'igshid',
  'igsh',
  'ref_src',
  'ref_url',
]);

/** Site-specific share/tracking parameters that are meaningful elsewhere, so only stripped here. */
const HOST_TRACKING_PARAMS: Record<string, readonly string[]> = {
  'x.com': ['s', 't', 'src'],
  'youtube.com': ['si', 'feature', 'pp'],
  'youtu.be': ['si', 'feature'],
  'open.spotify.com': ['si'],
  'linkedin.com': ['trk', 'trackingId', 'lipi', 'rcm', 'utm'],
  'instagram.com': ['img_index'],
  'reddit.com': ['share_id', 'rdt'],
};

/** Hosts that serve the same content as a primary host. */
const HOST_ALIASES: Record<string, string> = {
  'twitter.com': 'x.com',
  'mobile.twitter.com': 'x.com',
  'mobile.x.com': 'x.com',
  'm.youtube.com': 'youtube.com',
  'music.youtube.com': 'youtube.com',
  'm.facebook.com': 'facebook.com',
  'old.reddit.com': 'reddit.com',
  'new.reddit.com': 'reddit.com',
  'm.reddit.com': 'reddit.com',
};

function isTrackingParam(key: string, host: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.startsWith('utm_') ||
    GLOBAL_TRACKING_PARAMS.has(lower) ||
    (HOST_TRACKING_PARAMS[host]?.includes(key) ?? false)
  );
}

function stripTrackingParams(url: URL, host: string): void {
  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParam(key, host)) url.searchParams.delete(key);
  }
}

function canonicalHost(hostname: string): string {
  const withoutWww = hostname.replace(/^www\./, '');
  return HOST_ALIASES[withoutWww] ?? withoutWww;
}

/** Hash routes (`#/path`, `#!/path`) identify content in single-page apps; other fragments don't. */
function isRoutingFragment(hash: string): boolean {
  return hash.startsWith('#/') || hash.startsWith('#!/');
}

export function normalizeUrl(input: string): NormalizedUrl {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new InvalidUrlError('Not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidUrlError(`Unsupported URL scheme "${parsed.protocol}"`);
  }
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
    throw new InvalidUrlError('URL host is not a public domain');
  }
  parsed.username = '';
  parsed.password = '';

  const host = canonicalHost(parsed.hostname);

  // The link we store and open: tracking removed, everything else as the user saved it.
  const clean = new URL(parsed);
  stripTrackingParams(clean, host);

  // The identity key: https, no www, aliases resolved, sorted params, no trailing slash.
  const canonical = new URL(clean);
  canonical.protocol = 'https:';
  canonical.hostname = host;
  canonical.port = '';

  if (host === 'youtu.be') {
    const videoId = canonical.pathname.slice(1);
    canonical.hostname = 'youtube.com';
    canonical.pathname = '/watch';
    canonical.searchParams.set('v', videoId);
  }

  canonical.searchParams.sort();
  if (!isRoutingFragment(canonical.hash)) canonical.hash = '';
  if (canonical.pathname.length > 1 && canonical.pathname.endsWith('/')) {
    canonical.pathname = canonical.pathname.replace(/\/+$/, '');
  }

  return { url: clean.toString(), canonicalUrl: canonical.toString() };
}
