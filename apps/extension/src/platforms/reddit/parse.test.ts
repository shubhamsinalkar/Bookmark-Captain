import { describe, expect, it } from 'vitest';
import {
  parseSavedListing,
  parseSavedState,
  parseUsername,
  saveRequestIds,
  thingToPost,
} from './parse';

const textPost = {
  kind: 't3',
  data: {
    name: 't3_1nx4k2a',
    title: 'Got laid off on bday, even with a lot of dependency',
    selftext: 'As the title says, received the bad news on my bday &amp; more.',
    author: 'mriidicc',
    subreddit_name_prefixed: 'r/developersIndia',
    permalink: '/r/developersIndia/comments/1nx4k2a/got_laid_off_on_bday/',
    url: 'https://www.reddit.com/r/developersIndia/comments/1nx4k2a/got_laid_off_on_bday/',
    created_utc: 1759100000,
    score: 710,
    num_comments: 125,
    link_flair_text: 'General',
    thumbnail: 'self',
    over_18: false,
    saved: true,
  },
};

const linkPost = {
  kind: 't3',
  data: {
    name: 't3_1nw9z0b',
    title: 'A visual guide to Postgres indexes',
    selftext: '',
    author: 'pg_fan',
    subreddit_name_prefixed: 'r/PostgreSQL',
    permalink: '/r/PostgreSQL/comments/1nw9z0b/a_visual_guide/',
    url_overridden_by_dest: 'https://example.com/postgres-indexes',
    created_utc: 1759000000,
    thumbnail: 'https://b.thumbs.redditmedia.com/small.jpg',
    preview: {
      images: [{ source: { url: 'https://preview.redd.it/big.jpg?width=1200&amp;s=abc' } }],
    },
    saved: false,
  },
};

const comment = {
  kind: 't1',
  data: {
    name: 't1_ngh7k1x',
    body: 'Use a partial index here.',
    author: '[deleted]',
    link_title: 'Slow query on a big table',
    link_permalink: 'https://www.reddit.com/r/PostgreSQL/comments/1nv0000/slow_query/',
    subreddit_name_prefixed: 'r/PostgreSQL',
    permalink: '/r/PostgreSQL/comments/1nv0000/slow_query/ngh7k1x/',
    created_utc: 1758900000,
    score: 42,
  },
};

const listing = (children: unknown[], after: string | null = null) => ({
  kind: 'Listing',
  data: { after, children },
});

describe('thingToPost', () => {
  it('reads a text post', () => {
    expect(thingToPost(textPost)).toEqual({
      externalId: 't3_1nx4k2a',
      url: 'https://www.reddit.com/r/developersIndia/comments/1nx4k2a/got_laid_off_on_bday/',
      title: 'Got laid off on bday, even with a lot of dependency',
      text: 'As the title says, received the bad news on my bday &amp; more.',
      author: 'u/mriidicc',
      postedAt: new Date(1759100000 * 1000).toISOString(),
      metadata: {
        kind: 'post',
        subreddit: 'r/developersIndia',
        score: 710,
        comments: 125,
        flair: 'General',
      },
    });
  });

  it('keeps where a link post points, and its preview image', () => {
    const post = thingToPost(linkPost);
    expect(post?.thumbnailUrl).toBe('https://preview.redd.it/big.jpg?width=1200&s=abc');
    expect(post?.metadata).toMatchObject({ linkUrl: 'https://example.com/postgres-indexes' });
    expect(post?.text).toBeUndefined();
  });

  it('reads a saved comment, titled after its post', () => {
    expect(thingToPost(comment)).toMatchObject({
      externalId: 't1_ngh7k1x',
      url: 'https://www.reddit.com/r/PostgreSQL/comments/1nv0000/slow_query/ngh7k1x/',
      title: 'Comment on “Slow query on a big table”',
      text: 'Use a partial index here.',
      metadata: { kind: 'comment', postUrl: comment.data.link_permalink },
    });
    // Deleted authors aren't shown.
    expect(thingToPost(comment)?.author).toBeUndefined();
  });

  it('skips anything else', () => {
    expect(thingToPost({ kind: 't5', data: { name: 't5_abc', permalink: '/r/x/' } })).toBeNull();
    expect(thingToPost({ kind: 't3', data: { name: 't1_abc', permalink: '/r/x/' } })).toBeNull();
    expect(
      thingToPost({ kind: 't3', data: { name: 't3_abc', permalink: 'https://evil' } }),
    ).toBeNull();
    expect(thingToPost(null)).toBeNull();
  });
});

describe('parseSavedListing', () => {
  it('reads a page and its cursor', () => {
    const page = parseSavedListing(listing([textPost, { kind: 'more' }, comment], 't1_ngh7k1x'));
    expect(page.posts.map((post) => post.externalId)).toEqual(['t3_1nx4k2a', 't1_ngh7k1x']);
    expect(page.after).toBe('t1_ngh7k1x');
  });

  it('ends at a page without a cursor', () => {
    expect(parseSavedListing(listing([linkPost]))).toMatchObject({ after: null });
    expect(parseSavedListing({ error: 403 })).toEqual({ posts: [], after: null });
  });
});

describe('parseUsername', () => {
  it('reads the signed-in name, or null when signed out', () => {
    expect(parseUsername({ kind: 't2', data: { name: 'Independent_Bet_869' } })).toBe(
      'Independent_Bet_869',
    );
    expect(parseUsername({})).toBeNull();
    expect(parseUsername({ data: { name: '../../api' } })).toBeNull();
  });
});

describe('parseSavedState', () => {
  it('splits posts into saved and not saved', () => {
    const state = parseSavedState(listing([textPost, linkPost]));
    expect(state.saved.map((post) => post.externalId)).toEqual(['t3_1nx4k2a']);
    expect(state.unsaved).toEqual(['t3_1nw9z0b']);
  });
});

describe('saveRequestIds', () => {
  it('reads GraphQL save mutations, whatever they are called', () => {
    const persisted = JSON.stringify({
      operation: 'UpdatePostSaveState',
      variables: { input: { postId: 't3_1nx4k2a', saveState: 'SAVED' } },
      csrf_token: 'x',
    });
    expect(saveRequestIds('graphql', persisted)).toEqual(['t3_1nx4k2a']);
    const query = JSON.stringify({
      query: 'mutation SaveComment($id: ID!) { saveComment(id: $id) { ok } }',
      variables: { id: 't1_ngh7k1x' },
    });
    expect(saveRequestIds('graphql', query)).toEqual(['t1_ngh7k1x']);
  });

  it('reads the classic form-encoded save API', () => {
    expect(saveRequestIds('save', 'id=t3_1nx4k2a&executed=saved')).toEqual(['t3_1nx4k2a']);
  });

  it('ignores queries that merely ask whether posts are saved', () => {
    const feed = JSON.stringify({
      operation: 'PostDetail',
      query: 'query PostDetail($id: ID!) { post(id: $id) { isSaved } }',
      variables: { id: 't3_1nx4k2a' },
    });
    expect(saveRequestIds('graphql', feed)).toEqual([]);
    expect(saveRequestIds('graphql', undefined)).toEqual([]);
  });
});
