import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { graphqlOperation } from './constants';
import {
  bookmarkMutationTweetId,
  extractTweets,
  isSuccessfulResponse,
  minimalPost,
  parseBookmarksPage,
} from './parse';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('parseBookmarksPage', () => {
  const page = parseBookmarksPage(fixture('bookmarks-page'));

  it('reads bookmarked posts in order, skipping deleted ones and quoted posts', () => {
    expect(page.posts.map((post) => post.externalId)).toEqual([
      '1972900000000000001',
      '1972800000000000002',
    ]);
    expect(page.hasMore).toBe(true);
  });

  it('turns a reply into readable text: no leading mention, real links, no media link', () => {
    expect(page.posts[0]).toEqual({
      externalId: '1972900000000000001',
      url: 'https://x.com/xpcharan/status/1972900000000000001',
      title:
        "Thanks, found the original thread & it's great https://www.threads.com/@boris_cherny/post/1",
      text: "Thanks, found the original thread & it's great https://www.threads.com/@boris_cherny/post/1",
      author: 'charan (@xpcharan)',
      thumbnailUrl: 'https://pbs.twimg.com/media/abc.jpg',
      postedAt: '2025-09-30T06:12:00.000Z',
      metadata: {
        handle: 'xpcharan',
        authorName: 'charan',
        avatarUrl: 'https://pbs.twimg.com/profile_images/11/charan_normal.jpg',
        postedAt: '2025-09-30T06:12:00.000Z',
        mediaCount: 1,
      },
    });
  });

  it('uses the full text of long posts and the older user fields', () => {
    const post = page.posts[1]!;
    expect(post.text).toBe(
      'Completely free 6-month curriculum with labs and verification systems.\n\nLearn cloud from scratch: https://learntocloud.guide',
    );
    // Titles are one line.
    expect(post.title).toBe(
      'Completely free 6-month curriculum with labs and verification systems. Learn cloud from scratch: https://learntocloud.guide',
    );
    expect(post.author).toBe('GPS (@madebygps)');
    expect(post.metadata).toMatchObject({
      handle: 'madebygps',
      avatarUrl: 'https://pbs.twimg.com/profile_images/22/gps_normal.jpg',
      quotedPostId: '1972700000000000003',
    });
  });

  it('reports the end of the list', () => {
    expect(parseBookmarksPage(fixture('bookmarks-end'))).toEqual({ posts: [], hasMore: false });
  });

  it('ignores unrelated or malformed JSON', () => {
    expect(parseBookmarksPage(null)).toEqual({ posts: [], hasMore: false });
    expect(parseBookmarksPage({ data: { anything: [1, 'two', { three: 3 }] } }).posts).toEqual([]);
  });
});

describe('extractTweets', () => {
  it('finds every tweet in a response, including quoted posts', () => {
    const ids = extractTweets(fixture('bookmarks-page')).map((post) => post.externalId);
    expect(ids).toEqual(['1972900000000000001', '1972800000000000002', '1972700000000000003']);
  });

  it('decodes the HTML entities X puts in full_text', () => {
    const [post] = extractTweets(fixture('home-timeline'));
    expect(post).toMatchObject({
      externalId: '1972600000000000004',
      title: 'Ship small <changes>, ship them often.',
      author: 'Sam Alba (@sam_alba)',
    });
  });

  it('truncates long titles on a character boundary', () => {
    const long = '🚀'.repeat(400);
    const [post] = extractTweets({
      rest_id: '1',
      core: { user_results: { result: { core: { screen_name: 'a' } } } },
      legacy: { full_text: long },
    });
    const title = Array.from(post!.title!);
    expect(title).toHaveLength(280);
    expect(title.at(-1)).toBe('…');
    expect(post!.text).toBe(long);
  });

  it('gives media-only posts a readable title', () => {
    const [post] = extractTweets({
      rest_id: '2',
      core: { user_results: { result: { core: { screen_name: 'pics' } } } },
      legacy: {
        full_text: 'https://t.co/m',
        extended_entities: { media: [{ url: 'https://t.co/m' }] },
      },
    });
    expect(post).toMatchObject({ title: 'Post by @pics' });
    expect(post).not.toHaveProperty('text');
  });
});

describe('bookmark mutations', () => {
  it('reads the tweet id from the request body', () => {
    expect(bookmarkMutationTweetId('{"variables":{"tweet_id":"123"},"queryId":"q"}')).toBe('123');
    expect(bookmarkMutationTweetId('{"variables":{"tweet_id":"<script>"}}')).toBeNull();
    expect(bookmarkMutationTweetId('not json')).toBeNull();
    expect(bookmarkMutationTweetId(undefined)).toBeNull();
  });

  it('treats a 200 with errors as a failure', () => {
    expect(isSuccessfulResponse(200, { data: { tweet_bookmark_put: 'Done' } })).toBe(true);
    expect(isSuccessfulResponse(200, { errors: [{ message: 'Rate limit' }] })).toBe(false);
    expect(isSuccessfulResponse(429, {})).toBe(false);
  });

  it('builds a placeholder dated from the tweet id', () => {
    // Snowflake 1972600000000000004 → 2025-09-29 (ms since the Twitter epoch, << 22).
    expect(minimalPost('1972600000000000004')).toEqual({
      externalId: '1972600000000000004',
      url: 'https://x.com/i/status/1972600000000000004',
      title: 'Post on X',
      postedAt: new Date(Number((1972600000000000004n >> 22n) + 1288834974657n)).toISOString(),
    });
  });
});

describe('graphqlOperation', () => {
  it('reads the operation name, whatever the query id', () => {
    expect(graphqlOperation('https://x.com/i/api/graphql/aB3-x_9/Bookmarks?variables=%7B%7D')).toBe(
      'Bookmarks',
    );
    expect(graphqlOperation('/i/api/graphql/q1/CreateBookmark')).toBe('CreateBookmark');
    expect(graphqlOperation('https://x.com/i/api/2/notifications/all.json')).toBeNull();
  });
});
