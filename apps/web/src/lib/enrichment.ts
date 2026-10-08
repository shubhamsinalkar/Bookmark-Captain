import type { Bookmark, ContentType, ShelfLife } from '@bc/shared';
import { displayUrl, snippetFor } from './format';

/** `null` hides the label: "other" says nothing worth the space. */
export const CONTENT_TYPE_LABELS: Record<ContentType, string | null> = {
  article: 'Article',
  tutorial: 'Tutorial',
  thread: 'Thread',
  discussion: 'Discussion',
  video: 'Video',
  tool: 'Tool',
  news: 'News',
  opinion: 'Opinion',
  reference: 'Reference',
  other: null,
};

export const SHELF_LIFE_LABELS: Record<ShelfLife, { label: string; hint: string }> = {
  evergreen: { label: 'Evergreen', hint: 'Still worth reading in a year' },
  timely: { label: 'Timely', hint: 'Relevant for weeks or months' },
  ephemeral: { label: 'Short-lived', hint: 'Matters for days: read it soon or let it go' },
};

/** "4 min", "1 h", "1 h 20 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export interface CardText {
  title: string;
  /** The AI summary, once there is one. */
  summary: string | null;
  /** The saved text worth showing: the body under the title, or the whole post. */
  original: string | null;
}

/**
 * What a card shows. The AI headline replaces a title that is missing or is just the opening
 * words of a post (as with tweets); real titles, like an article's, are kept. When the headline
 * replaced a post's opening words, the "original" is the full post.
 */
export function cardText(bookmark: Bookmark): CardText {
  const enriched = bookmark.ai?.status === 'done' ? bookmark.ai : null;
  const snippet = snippetFor(bookmark.title, bookmark.text);
  const titleIsPostText = !bookmark.title || (bookmark.text !== null && snippet === null);
  const headline = titleIsPostText ? enriched?.headline : null;

  return {
    title: headline ?? bookmark.title ?? displayUrl(bookmark.url),
    summary: enriched?.summary ?? null,
    original: headline && bookmark.title ? bookmark.text : snippet,
  };
}
