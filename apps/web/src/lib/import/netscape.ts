import type { IngestItem } from '@bc/shared';

/**
 * Parses a Netscape bookmark file — the `bookmarks.html` exported by Chrome, Firefox, Safari
 * and Edge — into ingest items. Runs in the browser (uses DOMParser), so the file never has to
 * be uploaded whole. Non-http(s) entries are left for the API to reject.
 */
export function parseNetscapeBookmarks(html: string): IngestItem[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  return [...doc.querySelectorAll<HTMLAnchorElement>('a[href]')].map((anchor) => {
    const folders = folderPath(anchor);
    const savedAt = parseUnixSeconds(anchor.getAttribute('add_date'));
    const title = anchor.textContent?.trim();

    return {
      platform: 'browser',
      url: anchor.getAttribute('href') ?? '',
      ...(title && { title }),
      ...(savedAt && { savedAt }),
      ...(folders.length > 0 && { metadata: { folder: folders.join(' / ') } }),
    };
  });
}

/** ADD_DATE is Unix seconds; returns an ISO string, as the API expects. */
function parseUnixSeconds(value: string | null): string | undefined {
  const seconds = Number(value);
  return value && Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : undefined;
}

/**
 * Folder names from outermost to innermost. In the format, each folder is an <H3> whose
 * contents follow in a sibling <DL>; parsers nest the <DL> inside the folder's <DT>.
 */
function folderPath(anchor: Element): string[] {
  const names: string[] = [];
  for (let list = anchor.closest('dl'); list; list = list.parentElement?.closest('dl') ?? null) {
    const heading = findFolderHeading(list);
    if (heading) names.unshift(heading);
  }
  return names;
}

function findFolderHeading(list: Element): string | undefined {
  for (let node = list.previousElementSibling; node; node = node.previousElementSibling) {
    if (node.tagName === 'H3') return node.textContent?.trim() || undefined;
    if (node.tagName !== 'P') break;
  }
  const owner = list.parentElement;
  if (owner?.tagName === 'DT') {
    return owner.querySelector(':scope > h3')?.textContent?.trim() || undefined;
  }
  return undefined;
}
