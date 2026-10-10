const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

/** "3 days ago", "in 2 hours", "just now". */
export function formatRelativeTime(date: Date | string, now: Date = new Date()): string {
  const seconds = (new Date(date).getTime() - now.getTime()) / 1000;
  for (const [unit, unitSeconds] of UNITS) {
    if (Math.abs(seconds) >= unitSeconds) {
      return relativeFormatter.format(Math.round(seconds / unitSeconds), unit);
    }
  }
  return 'just now';
}

const AGE_UNITS: [string, number][] = [
  ['y', 365 * 24 * 60 * 60],
  ['mo', 30 * 24 * 60 * 60],
  ['w', 7 * 24 * 60 * 60],
  ['d', 24 * 60 * 60],
  ['h', 60 * 60],
  ['m', 60],
];

/** Compact age for tight spaces: "now", "5m", "3h", "2d", "2w", "4mo", "1y". */
export function formatAge(date: Date | string, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(date).getTime()) / 1000);
  for (const [unit, unitSeconds] of AGE_UNITS) {
    if (seconds >= unitSeconds) return `${Math.floor(seconds / unitSeconds)}${unit}`;
  }
  return 'now';
}

/** Hostname without `www.`, for compact display. Falls back to the raw input. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * A readable stand-in title for links saved without one: host plus path, without query
 * string, e.g. "postgresql.org/docs/current/queries-with.html".
 */
export function displayUrl(url: string): string {
  try {
    const { pathname } = new URL(url);
    const path = decodeURIComponent(pathname).replace(/\/+$/, '');
    return `${displayHost(url)}${path}`;
  } catch {
    return url;
  }
}

/**
 * The body text worth showing under a title, or null when the title already is that text
 * (social posts like tweets use their own text, shortened to one line, as the title).
 */
export function snippetFor(title: string | null, text: string | null): string | null {
  if (!text) return null;
  if (!title) return text;
  const flat = text.replace(/\s+/g, ' ').trim();
  const head = title.replace(/…$/, '').trim();
  return flat.startsWith(head) ? null : text;
}

/** Next occurrence of 09:00 local time, `daysAhead` days from today. */
export function morningInDays(daysAhead: number, from: Date = new Date()): Date {
  const date = new Date(from);
  date.setDate(date.getDate() + daysAhead);
  date.setHours(9, 0, 0, 0);
  return date;
}
