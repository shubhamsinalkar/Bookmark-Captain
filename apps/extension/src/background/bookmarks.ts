import type { IngestItem } from '@bc/shared';

/** The subset of chrome.bookmarks.BookmarkTreeNode this module needs (keeps it testable). */
export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
  children?: BookmarkNode[];
}

/** Only web links can be saved; bookmarklets, chrome:// pages and files are skipped early. */
export function isSyncableUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

export function toIngestItem(node: BookmarkNode & { url: string }, folders: string[]): IngestItem {
  const title = node.title.trim();
  return {
    platform: 'browser',
    url: node.url,
    ...(title && { title }),
    ...(node.dateAdded && { savedAt: new Date(node.dateAdded).toISOString() }),
    ...(folders.length > 0 && { metadata: { folder: folders.join(' / ') } }),
  };
}

export interface FlattenedTree {
  items: IngestItem[];
  /** Chrome bookmark id → URL, so URL edits can remove the old address. */
  urlById: Record<string, string>;
}

/**
 * Walks a bookmark tree (from chrome.bookmarks.getTree/getSubTree) into ingest items,
 * recording each link's folder path. `basePath` is the folder path of the given roots'
 * parent (for subtrees); the unnamed root of the full tree adds nothing.
 */
export function flattenTree(roots: BookmarkNode[], basePath: string[] = []): FlattenedTree {
  const items: IngestItem[] = [];
  const urlById: Record<string, string> = {};

  const visit = (node: BookmarkNode, folders: string[]) => {
    if (node.url !== undefined) {
      if (!isSyncableUrl(node.url)) return;
      items.push(toIngestItem({ ...node, url: node.url }, folders));
      urlById[node.id] = node.url;
      return;
    }
    const path = node.title ? [...folders, node.title] : folders;
    for (const child of node.children ?? []) visit(child, path);
  };

  for (const root of roots) visit(root, basePath);
  return { items, urlById };
}

/** Every syncable URL inside a removed node (a removed folder takes its whole subtree). */
export function collectUrls(node: BookmarkNode): string[] {
  if (node.url !== undefined) return isSyncableUrl(node.url) ? [node.url] : [];
  return (node.children ?? []).flatMap(collectUrls);
}

/** Every bookmark id inside a node, for cleaning up the id → URL map. */
export function collectIds(node: BookmarkNode): string[] {
  return [node.id, ...(node.children ?? []).flatMap(collectIds)];
}
