import { describe, expect, it } from 'vitest';
import { itemToPost, parseSavedPage, parseSaveRequest } from './parse';

/** Shaped like `/api/v1/reader/saved?filter=posts` items (trimmed; the real ones carry more). */
const postItem = (id: number, overrides: Record<string, unknown> = {}) => ({
  entity_key: `p-${id}`,
  type: 'post',
  context: { type: 'post', timestamp: '2026-11-12T16:04:46.574Z', users: [{ id: 1 }] },
  publication: {
    id: 9,
    name: 'Better Engineers',
    base_url: 'https://betterengineers.substack.com',
    author_name: 'Better Engineering',
  },
  post: {
    id,
    title: 'How Slack Scaled MySQL',
    subtitle: '',
    description: 'The engineering story behind Slack’s migration to Vitess.',
    canonical_url: 'https://betterengineers.substack.com/p/how-slack-scaled-mysql',
    cover_image: 'https://substackcdn.com/image/fetch/cover.png',
    post_date: '2026-11-06T11:03:41.013Z',
    type: 'newsletter',
    wordcount: 3087,
    publishedBylines: [{ name: 'Better Engineering', handle: 'betterengineers' }],
    ...overrides,
  },
});

/** Shaped like `filter=notes` items: a note is a `comment` with the note's text. */
const noteItem = (id: number, comment: Record<string, unknown> = {}) => ({
  entity_key: `c-${id}`,
  type: 'comment',
  context: { type: 'note', timestamp: '2026-11-12T16:13:10.772Z' },
  publication: null,
  post: null,
  comment: {
    id,
    name: 'Better Engineering',
    handle: 'betterengineers',
    body: 'Scale From Zero to Millions of Users\n\nYour app runs on one server.',
    date: '2026-11-10T03:09:27.295Z',
    type: 'feed',
    attachments: [
      {
        id: 'a1',
        type: 'post',
        post: {
          id: 147131910,
          title: 'System Design - Scale 0 to Millions of Users',
          canonical_url: 'https://betterengineers.substack.com/p/system-design',
          cover_image: 'https://substackcdn.com/image/fetch/system.png',
        },
      },
    ],
    ...comment,
  },
});

describe('itemToPost', () => {
  it('reads a saved post, dated by when you saved it', () => {
    expect(itemToPost(postItem(222769099))).toEqual({
      externalId: 'p-222769099',
      url: 'https://betterengineers.substack.com/p/how-slack-scaled-mysql',
      title: 'How Slack Scaled MySQL',
      author: 'Better Engineering',
      text: 'The engineering story behind Slack’s migration to Vitess.',
      thumbnailUrl: 'https://substackcdn.com/image/fetch/cover.png',
      postedAt: '2026-11-06T11:03:41.013Z',
      savedAt: '2026-11-12T16:04:46.574Z',
      metadata: {
        kind: 'post',
        publication: 'Better Engineers',
        publicationUrl: 'https://betterengineers.substack.com',
        words: 3087,
        postType: 'newsletter',
      },
    });
  });

  it('prefers the subtitle and names every author', () => {
    const post = itemToPost(
      postItem(1, {
        subtitle: 'First principles',
        publishedBylines: [{ name: 'Ada' }, { name: 'Grace' }],
      }),
    );
    expect(post?.text).toBe('First principles');
    expect(post?.author).toBe('Ada, Grace');
  });

  it('reads a saved note: first line as the title, the rest as its text', () => {
    expect(itemToPost(noteItem(383394571))).toEqual({
      externalId: 'c-383394571',
      url: 'https://substack.com/@betterengineers/note/c-383394571',
      title: 'Scale From Zero to Millions of Users',
      author: 'Better Engineering',
      text: 'Your app runs on one server.',
      thumbnailUrl: 'https://substackcdn.com/image/fetch/system.png',
      postedAt: '2026-11-10T03:09:27.295Z',
      savedAt: '2026-11-12T16:13:10.772Z',
      metadata: {
        kind: 'note',
        handle: 'betterengineers',
        sharedPostTitle: 'System Design - Scale 0 to Millions of Users',
        sharedPostUrl: 'https://betterengineers.substack.com/p/system-design',
      },
    });
  });

  it('titles a note without text by what it shares, and prefers its own picture', () => {
    const note = itemToPost(
      noteItem(2, {
        body: '',
        attachments: [
          { type: 'image', imageUrl: 'https://substackcdn.com/image/fetch/photo.jpg' },
          ...noteItem(2).comment.attachments,
        ],
      }),
    );
    expect(note?.title).toBe('System Design - Scale 0 to Millions of Users');
    expect(note?.thumbnailUrl).toBe('https://substackcdn.com/image/fetch/photo.jpg');
    expect(itemToPost(noteItem(3, { body: '', attachments: [] }))?.title).toBe(
      'Note by Better Engineering',
    );
  });

  it('keeps the whole text when the first line is too long for a title', () => {
    const body = `${'word '.repeat(40)}end`;
    const note = itemToPost(noteItem(4, { body }));
    expect(note?.title).toHaveLength(120);
    expect(note?.title?.endsWith('…')).toBe(true);
    expect(note?.text).toBe(body);
  });

  it('skips links and anything it cannot read', () => {
    expect(itemToPost({ entity_key: 'l-1', type: 'link', link_url: 'https://a.example' })).toBe(
      null,
    );
    expect(itemToPost(postItem(5, { canonical_url: 'javascript:alert(1)' }))).toBe(null);
    expect(itemToPost({ ...postItem(6), entity_key: 'p-7' })).toBe(null);
    expect(itemToPost(noteItem(8, { handle: '../evil' }))).toBe(null);
    expect(itemToPost(null)).toBe(null);
  });
});

describe('parseSavedPage', () => {
  it('reads a page and its cursor', () => {
    const page = parseSavedPage({
      items: [postItem(1), { type: 'mystery' }],
      originalCursorTimestamp: '2026-11-12T16:14:11.035Z',
      nextCursor: 'eyJiZWZvcmUiOiIyMDI2In0=',
    });
    expect(page?.posts.map((post) => post.externalId)).toEqual(['p-1']);
    expect(page?.itemCount).toBe(2);
    expect(page?.nextCursor).toBe('eyJiZWZvcmUiOiIyMDI2In0=');
  });

  it('tells an empty list from an answer that is not a list', () => {
    expect(parseSavedPage({ items: [], nextCursor: null })).toEqual({
      posts: [],
      itemCount: 0,
      nextCursor: null,
    });
    expect(parseSavedPage({ error: '' })).toBe(null);
    expect(parseSavedPage('<html>')).toBe(null);
  });
});

describe('parseSaveRequest', () => {
  it('reads post saves and unsaves from the method and body', () => {
    expect(parseSaveRequest('post', 'POST', '{"post_id":215463184}')).toEqual({
      list: 'posts',
      key: 'p-215463184',
      action: 'save',
    });
    expect(parseSaveRequest('post', 'DELETE', '{"post_id":215463184}')).toEqual({
      list: 'posts',
      key: 'p-215463184',
      action: 'unsave',
    });
    // Still a change, even when the post isn't named.
    expect(parseSaveRequest('post', 'POST', 'not json')).toEqual({
      list: 'posts',
      key: null,
      action: 'save',
    });
  });

  it('reads note saves from the address', () => {
    expect(parseSaveRequest('note:c-383394571', 'POST', undefined)).toEqual({
      list: 'notes',
      key: 'c-383394571',
      action: 'save',
    });
    expect(parseSaveRequest('note:c-383394571', 'DELETE', undefined)?.action).toBe('unsave');
  });

  it('ignores anything that is not a save or unsave', () => {
    expect(parseSaveRequest('post', 'GET', undefined)).toBe(null);
    expect(parseSaveRequest('other', 'POST', '{"post_id":1}')).toBe(null);
  });
});
