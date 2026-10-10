import { type BookmarkView, bookmarkViewSchema, type Platform, platformSchema } from '@bc/shared';

/** What the inbox shows, kept in the URL so views are linkable and Back works. */
export interface InboxLocation {
  view: BookmarkView;
  /** Only bookmarks from this platform or site. */
  source?: Platform | undefined;
}

/** Reads `?view=done&source=x`; anything unrecognised falls back to the whole inbox. */
export function parseInboxParams(params: Pick<URLSearchParams, 'get'>): InboxLocation {
  const view = bookmarkViewSchema.safeParse(params.get('view'));
  const source = platformSchema.safeParse(params.get('source'));
  return {
    view: view.success ? view.data : 'inbox',
    source: source.success ? source.data : undefined,
  };
}

export function inboxHref({ view, source }: InboxLocation): string {
  const params = new URLSearchParams();
  if (view !== 'inbox') params.set('view', view);
  if (source) params.set('source', source);
  const query = params.toString();
  return query ? `/inbox?${query}` : '/inbox';
}

const LINK = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(:\d+)?([/?#]\S*)?$/i;

/** Endings that make a bare `name.tld` a site rather than a word like "next.js". */
const COMMON_TLDS = new Set(
  'com org net io dev app co ai me in us uk de fr es it nl ca au jp cn br edu gov info xyz tv gg ly so sh to fm news blog site tech page'.split(
    ' ',
  ),
);

/** Whether typed text is a web link to save rather than words to search for. */
export function looksLikeLink(text: string): boolean {
  const value = text.trim();
  if (!LINK.test(value)) return false;
  if (/^(https?:\/\/|www\.)/i.test(value) || /[/?#]/.test(value)) return true;
  const host = value.split(':')[0] ?? '';
  return COMMON_TLDS.has(host.slice(host.lastIndexOf('.') + 1).toLowerCase());
}
