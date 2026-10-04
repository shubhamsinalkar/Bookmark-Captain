import { describe, expect, it } from 'vitest';
import {
  isLoginRequired,
  mediaIdOf,
  mediaToPost,
  parseSavedFeed,
  parseSavedState,
  saveRequestIds,
} from './parse';

const photo = {
  id: '3456789012345678901_25025320',
  // eslint-disable-next-line no-loss-of-precision -- As Instagram sends it: too big to be exact.
  pk: 3456789012345678901,
  code: 'DAbC12xYz_9',
  media_type: 1,
  taken_at: 1759100000,
  like_count: 1520,
  comment_count: 48,
  caption: { text: 'Sunday market haul 🥕\n\nRecipe in the comments.' },
  user: { username: 'chef_anna', full_name: 'Anna' },
  image_versions2: {
    candidates: [{ url: 'https://scontent.cdninstagram.com/v/big.jpg', width: 1080 }],
  },
  has_viewer_saved: true,
};

const reel = {
  id: '3456000000000000002_99',
  code: 'DReel000002',
  media_type: 2,
  product_type: 'clips',
  taken_at: 1759000000,
  user: { username: 'ferris' },
  image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/v/cover.jpg' }] },
  has_viewer_saved: false,
};

const carousel = {
  id: '3456000000000000003_7',
  code: 'DCarousel03',
  media_type: 8,
  caption: null,
  user: { username: 'greenthumb', full_name: 'Gita' },
  carousel_media: [
    {
      image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/v/slide1.jpg' }] },
    },
    {
      image_versions2: { candidates: [{ url: 'https://scontent.cdninstagram.com/v/slide2.jpg' }] },
    },
  ],
};

describe('mediaToPost', () => {
  it('reads a photo post', () => {
    expect(mediaToPost(photo)).toEqual({
      externalId: 'DAbC12xYz_9',
      url: 'https://www.instagram.com/p/DAbC12xYz_9/',
      title: 'Sunday market haul 🥕 Recipe in the comments.',
      text: 'Sunday market haul 🥕\n\nRecipe in the comments.',
      author: 'Anna (@chef_anna)',
      thumbnailUrl: 'https://scontent.cdninstagram.com/v/big.jpg',
      postedAt: new Date(1759100000 * 1000).toISOString(),
      metadata: {
        kind: 'photo',
        handle: 'chef_anna',
        authorName: 'Anna',
        // From the string id: the numeric pk has lost precision by the time JSON parses it.
        mediaId: '3456789012345678901',
        likes: 1520,
        comments: 48,
      },
    });
  });

  it('links reels as reels, and titles posts without a caption', () => {
    expect(mediaToPost(reel)).toMatchObject({
      url: 'https://www.instagram.com/reel/DReel000002/',
      title: 'Reel by @ferris',
      author: '@ferris',
      metadata: { kind: 'reel' },
    });
    expect(mediaToPost(carousel)).toMatchObject({
      title: 'Post by @greenthumb',
      thumbnailUrl: 'https://scontent.cdninstagram.com/v/slide1.jpg',
      metadata: { kind: 'carousel', mediaCount: 2 },
    });
  });

  it('skips anything without a valid shortcode', () => {
    expect(mediaToPost({ ...photo, code: '../../x' })).toBeNull();
    expect(mediaToPost({ id: '1_2' })).toBeNull();
    expect(mediaToPost(null)).toBeNull();
  });
});

describe('mediaIdOf', () => {
  it('reads the id exactly from the string id', () => {
    expect(mediaIdOf(photo)).toBe('3456789012345678901');
    expect(mediaIdOf({ id: 'nope' })).toBeNull();
  });
});

describe('parseSavedFeed', () => {
  it('reads a page and its cursor', () => {
    const page = parseSavedFeed({
      items: [{ media: photo }, { media: reel }, { something: 'else' }],
      more_available: true,
      next_max_id: 'QVFE-next',
      status: 'ok',
    });
    expect(page.posts.map((post) => post.externalId)).toEqual(['DAbC12xYz_9', 'DReel000002']);
    expect(page.nextMaxId).toBe('QVFE-next');
  });

  it('ends when no more are available', () => {
    expect(parseSavedFeed({ items: [{ media: carousel }], more_available: false })).toMatchObject({
      nextMaxId: null,
    });
    expect(parseSavedFeed(null)).toEqual({ posts: [], nextMaxId: null });
  });
});

describe('isLoginRequired', () => {
  it('recognises a signed-out answer', () => {
    expect(isLoginRequired(200, { message: 'login_required', status: 'fail' })).toBe(true);
    expect(isLoginRequired(401, null)).toBe(true);
    expect(isLoginRequired(200, { items: [], status: 'ok' })).toBe(false);
  });
});

describe('parseSavedState', () => {
  it('splits posts into saved and not saved', () => {
    const state = parseSavedState({ items: [photo, reel] });
    expect(state.saved.map((post) => post.externalId)).toEqual(['DAbC12xYz_9']);
    expect(state.unsaved).toEqual(['DReel000002']);
  });
});

describe('saveRequestIds', () => {
  it('reads the media id of the save endpoints', () => {
    expect(saveRequestIds('save:3456789012345678901', undefined)).toEqual(['3456789012345678901']);
  });

  it('reads GraphQL mutations named after saving', () => {
    const body = new URLSearchParams({
      fb_api_req_friendly_name: 'usePolarisSaveMediaSaveMutation',
      variables: JSON.stringify({ media_id: '3456789012345678901', container_module: 'feed' }),
      doc_id: '123',
    }).toString();
    expect(saveRequestIds('graphql', body)).toEqual(['3456789012345678901']);
  });

  it('ignores other GraphQL requests', () => {
    const body = new URLSearchParams({
      fb_api_req_friendly_name: 'PolarisPostRootQuery',
      variables: JSON.stringify({ media_id: '3456789012345678901' }),
    }).toString();
    expect(saveRequestIds('graphql', body)).toEqual([]);
    expect(saveRequestIds('saved-feed', body)).toEqual([]);
  });
});
