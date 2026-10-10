import type { Bookmark } from '@bc/shared';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);
const YOUTUBE_ID = /^[\w-]{11}$/;

/** GitHub paths that look like `owner/repo` but aren't repositories. */
const GITHUB_RESERVED = new Set([
  'about',
  'apps',
  'collections',
  'features',
  'issues',
  'login',
  'marketplace',
  'notifications',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'settings',
  'sponsors',
  'topics',
  'trending',
]);

function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1] ?? null;
  else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = url.pathname.split('/');
    id =
      first === 'watch'
        ? url.searchParams.get('v')
        : first === 'shorts' || first === 'embed' || first === 'live'
          ? (second ?? null)
          : null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

function githubRepo(url: URL): string | null {
  if (url.hostname.toLowerCase() !== 'github.com') return null;
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo || GITHUB_RESERVED.has(owner.toLowerCase())) return null;
  return `${owner}/${repo.replace(/\.git$/, '')}`;
}

/**
 * The picture to show for a bookmark: the one its source sent, or one that a well-known URL
 * implies (a YouTube video's thumbnail, a GitHub repository's social card). Null otherwise.
 */
export function thumbnailFor(bookmark: Pick<Bookmark, 'thumbnailUrl' | 'url'>): string | null {
  if (bookmark.thumbnailUrl) return bookmark.thumbnailUrl;
  let url: URL;
  try {
    url = new URL(bookmark.url);
  } catch {
    return null;
  }
  const video = youtubeVideoId(url);
  if (video) return `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
  const repo = githubRepo(url);
  if (repo) return `https://opengraph.githubassets.com/1/${repo}`;
  return null;
}

/** A site's icon, at least `size` pixels wide when the site has one that large. */
export function faviconUrl(host: string, size: number): string {
  const params = new URLSearchParams({ domain: host, sz: String(size) });
  return `https://www.google.com/s2/favicons?${params.toString()}`;
}

/** A stable hue (0–359) for a string, used to tint covers and letter tiles per site. */
export function hueFor(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % 360;
}
