import { describe, expect, it } from 'vitest';
import { type BookmarkNode, collectIds, collectUrls, flattenTree } from './bookmarks';

// Shape of chrome.bookmarks.getTree(): an unnamed root holding the built-in folders.
const tree: BookmarkNode[] = [
  {
    id: '0',
    title: '',
    children: [
      {
        id: '1',
        title: 'Bookmarks bar',
        children: [
          {
            id: '10',
            title: ' Rust book ',
            url: 'https://doc.rust-lang.org/book/',
            dateAdded: 1_700_000_000_000,
          },
          {
            id: '11',
            title: 'Dev',
            children: [
              { id: '12', title: 'Repo', url: 'https://github.com/a/b' },
              { id: '13', title: 'Bookmarklet', url: 'javascript:alert(1)' },
            ],
          },
        ],
      },
      {
        id: '2',
        title: 'Other bookmarks',
        children: [{ id: '20', title: '', url: 'http://example.com' }],
      },
    ],
  },
];

describe('flattenTree', () => {
  it('turns web links into ingest items with folder paths', () => {
    const { items, urlById } = flattenTree(tree);
    expect(items).toEqual([
      {
        platform: 'browser',
        url: 'https://doc.rust-lang.org/book/',
        title: 'Rust book',
        savedAt: '2023-11-14T22:13:20.000Z',
        metadata: { folder: 'Bookmarks bar' },
      },
      {
        platform: 'browser',
        url: 'https://github.com/a/b',
        title: 'Repo',
        metadata: { folder: 'Bookmarks bar / Dev' },
      },
      { platform: 'browser', url: 'http://example.com', metadata: { folder: 'Other bookmarks' } },
    ]);
    expect(urlById).toEqual({
      '10': 'https://doc.rust-lang.org/book/',
      '12': 'https://github.com/a/b',
      '20': 'http://example.com',
    });
  });

  it('prefixes a subtree with its parent folders', () => {
    const dev = tree[0]!.children![0]!.children![1]!;
    const { items } = flattenTree([dev], ['Bookmarks bar']);
    expect(items.map((item) => item.metadata)).toEqual([{ folder: 'Bookmarks bar / Dev' }]);
  });
});

describe('collectUrls / collectIds', () => {
  it('walks a removed folder', () => {
    const dev = tree[0]!.children![0]!.children![1]!;
    expect(collectUrls(dev)).toEqual(['https://github.com/a/b']);
    expect(collectIds(dev)).toEqual(['11', '12', '13']);
  });
});
