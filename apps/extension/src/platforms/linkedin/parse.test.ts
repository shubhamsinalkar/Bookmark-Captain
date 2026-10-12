import { describe, expect, it } from 'vitest';
import {
  extractFeedPosts,
  imageOf,
  isSignedOutResponse,
  minimalPost,
  parseSavedPostsPage,
  postedAtOf,
  saveActionOfLabel,
  saveChange,
  savedPostsDatalet,
  savedPostsPageAddress,
} from './parse';

// 7380000000000000001 >> 22 is a time in October 2025.
const URN_1 = 'urn:li:activity:7380000000000000001';
const URN_2 = 'urn:li:activity:7370000000000000002';
const URN_3 = 'urn:li:ugcPost:7360000000000000003';

const vectorImage = (name: string) => ({
  rootUrl: 'https://media.licdn.com/dms/image/v2/',
  artifacts: [
    { width: 100, fileIdentifyingUrlPathSegment: `${name}-small.jpg` },
    { width: 800, fileIdentifyingUrlPathSegment: `${name}-large.jpg` },
  ],
});

const result = (urn: string, fields: Record<string, unknown> = {}) => ({
  $type: 'com.linkedin.voyager.dash.search.EntityResultViewModel',
  entityUrn: `urn:li:fsd_entityResultViewModel:(${urn},SEARCH_MY_ITEMS_SAVED_POSTS,DEFAULT)`,
  trackingUrn: urn,
  navigationUrl: `https://www.linkedin.com/feed/update/${urn}/`,
  image: {
    attributes: [{ detailData: { nonEntityProfilePicture: { vectorImage: vectorImage('face') } } }],
  },
  ...fields,
});

const ref = (urn: string) =>
  `urn:li:fsd_entityResultViewModel:(${urn},SEARCH_MY_ITEMS_SAVED_POSTS,DEFAULT)`;

/** A saved-posts page as the web app receives it: the list refers to results in `included`. */
const savedPage = {
  data: {
    data: {
      searchDashClustersByAll: {
        paging: { start: 0, count: 10, total: 23 },
        elements: [
          {
            items: [URN_1, URN_2, URN_3].map((urn) => ({ item: { '*entityResult': ref(urn) } })),
          },
        ],
      },
    },
  },
  // Not in list order, on purpose.
  included: [
    result(URN_3, { title: { text: 'Kim Park' }, summary: { text: '' } }),
    { $type: 'com.linkedin.voyager.dash.identity.profile.Profile', publicIdentifier: 'jane' },
    result(URN_1, {
      title: { text: 'Jane Doe' },
      primarySubtitle: { text: 'Staff engineer at Example' },
      summary: { text: 'Notes from our incident review:\nwhat went right and wrong.' },
      entityEmbeddedObject: {
        image: { attributes: [{ detailData: { vectorImage: vectorImage('chart') } }] },
      },
    }),
    result(URN_2, {
      title: { text: 'Sam Lee' },
      summary: { text: 'A short guide to design docs' },
      entityEmbeddedObject: {
        title: { text: 'Design docs people read' },
        navigationUrl: 'https://example.com/design-docs',
      },
    }),
  ],
};

describe('parseSavedPostsPage', () => {
  const page = parseSavedPostsPage(savedPage);

  it('reads the results in list order, with their paging', () => {
    expect(page.posts.map((post) => post.externalId)).toEqual([URN_1, URN_2, URN_3]);
    expect(page.count).toBe(10);
    expect(page.total).toBe(23);
  });

  it('reads a post: author, text, image and when it was posted', () => {
    expect(page.posts[0]).toEqual({
      externalId: URN_1,
      url: `https://www.linkedin.com/feed/update/${URN_1}/`,
      title: 'Notes from our incident review: what went right and wrong.',
      text: 'Notes from our incident review:\nwhat went right and wrong.',
      author: 'Jane Doe',
      thumbnailUrl: 'https://media.licdn.com/dms/image/v2/chart-large.jpg',
      // Only as metadata: a post's publish date must not become its saved date.
      metadata: {
        urn: URN_1,
        postedAt: postedAtOf(URN_1),
        authorHeadline: 'Staff engineer at Example',
      },
    });
  });

  it('keeps a shared article, and titles posts without text', () => {
    expect(page.posts[1]).toMatchObject({
      metadata: {
        articleTitle: 'Design docs people read',
        articleUrl: 'https://example.com/design-docs',
      },
    });
    // The author's face is not the post's image.
    expect(page.posts[2]).toMatchObject({ title: 'Post by Kim Park' });
    expect(page.posts[2]?.thumbnailUrl).toBeUndefined();
    expect(page.posts[2]?.url).toBe(`https://www.linkedin.com/feed/update/${URN_3}/`);
  });

  it('reads results nested in place, and pages without paging', () => {
    const nested = { elements: [{ items: [{ item: { entityResult: result(URN_2) } }] }] };
    expect(parseSavedPostsPage(nested)).toEqual({
      posts: [expect.objectContaining({ externalId: URN_2, title: 'LinkedIn post' })],
      count: null,
      total: null,
    });
  });

  it('skips anything it does not recognise', () => {
    expect(parseSavedPostsPage(null).posts).toEqual([]);
    expect(
      parseSavedPostsPage({ included: [{ entityUrn: 'urn:li:fsd_profile:1' }] }).posts,
    ).toEqual([]);
  });
});

describe('extractFeedPosts', () => {
  it('reads feed updates', () => {
    const feed = {
      included: [
        {
          $type: 'com.linkedin.voyager.dash.feed.Update',
          entityUrn: `urn:li:fsd_update:(${URN_1},MAIN_FEED,EMPTY,DEFAULT,false)`,
          metadata: { backendUrn: URN_1 },
          actor: { name: { text: 'Jane Doe' }, description: { text: 'Staff engineer' } },
          commentary: { text: { text: 'We are hiring!' } },
          content: {
            imageComponent: {
              images: [{ attributes: [{ detailData: { vectorImage: vectorImage('team') } }] }],
            },
          },
        },
        {
          $type: 'com.linkedin.voyager.dash.feed.SocialDetail',
          entityUrn: 'urn:li:fsd_socialDetail:1',
        },
      ],
    };
    expect(extractFeedPosts(feed)).toEqual([
      expect.objectContaining({
        externalId: URN_1,
        title: 'We are hiring!',
        author: 'Jane Doe',
        thumbnailUrl: 'https://media.licdn.com/dms/image/v2/team-large.jpg',
      }),
    ]);
  });
});

describe('postedAtOf', () => {
  it('reads the time from the id, and ignores ids that are not times', () => {
    expect(postedAtOf(URN_1)?.startsWith('2025-')).toBe(true);
    expect(postedAtOf('urn:li:activity:12345')).toBeUndefined();
  });
});

describe('imageOf', () => {
  it('takes the largest rendition, or a plain image address', () => {
    expect(imageOf({ a: [{ vectorImage: vectorImage('x') }] })).toBe(
      'https://media.licdn.com/dms/image/v2/x-large.jpg',
    );
    expect(imageOf({ imageUrl: { url: 'https://media.licdn.com/p.jpg' } })).toBe(
      'https://media.licdn.com/p.jpg',
    );
    expect(imageOf(undefined)).toBeUndefined();
  });
});

describe('savedPostsPageAddress', () => {
  const page =
    '/voyager/api/graphql?variables=(start:0,query:(flagshipSearchIntent:SEARCH_MY_ITEMS_SAVED_POSTS))&queryId=q.1';

  it('swaps the start of the address the page used', () => {
    expect(savedPostsPageAddress(page, 20)).toBe(page.replace('start:0', 'start:20'));
    expect(savedPostsPageAddress('/g?variables=%28start%3A10%2Cq%29', 30)).toBe(
      '/g?variables=%28start%3A30%2Cq%29',
    );
  });

  it('adds a start when the address has none', () => {
    expect(savedPostsPageAddress('/g?variables=(query:(x))&queryId=q', 10)).toBe(
      '/g?variables=(start:10,query:(x))&queryId=q',
    );
  });
});

describe('savedPostsDatalet', () => {
  it('finds the saved list among the data rendered into the page', () => {
    const datalet = JSON.stringify({
      request:
        '/voyager/api/graphql?variables=(start:0,query:(flagshipSearchIntent:SEARCH_MY_ITEMS_SAVED_POSTS))&queryId=q.1',
      status: 200,
      body: 'bpr-guid-42',
    });
    expect(savedPostsDatalet(datalet)).toEqual({
      request: expect.stringContaining('SEARCH_MY_ITEMS_SAVED_POSTS') as string,
      body: 'bpr-guid-42',
    });
    expect(
      savedPostsDatalet(JSON.stringify({ request: '/voyager/api/me', body: 'bpr-guid-1' })),
    ).toBeNull();
    expect(savedPostsDatalet('not json')).toBeNull();
  });
});

describe('saveChange', () => {
  it('reads the post and which way it went', () => {
    expect(saveChange(`save-state:${URN_1}`, '{"patch":{"$set":{"saved":true}}}')).toEqual({
      urn: URN_1,
      saved: true,
    });
    expect(saveChange('save-state:', `{"urn":"${URN_2}","saved": false}`)).toEqual({
      urn: URN_2,
      saved: false,
    });
    expect(saveChange(`save-state:${URN_1}`, undefined)).toEqual({ urn: URN_1, saved: null });
  });

  it("reads the 2026 feed's save action, which names the post by its id alone", () => {
    // As sent by the feed's ⋯ menu (`sduiid=com.linkedin.sdui.update.saveState`), trimmed.
    const body = (isSaved: boolean) =>
      JSON.stringify({
        requestId: 'com.linkedin.sdui.update.saveState',
        serverRequest: {
          requestedArguments: {
            payload: {
              isSaved,
              saveObjectUrn: {
                saveEntityUrnFeedUpdateUrn: {
                  feedUpdateUrn: {
                    updateUrnActivityUrn: { activityUrn: { activityId: '7514732881370415104' } },
                  },
                },
              },
            },
          },
        },
      });
    const urn = 'urn:li:activity:7514732881370415104';
    expect(saveChange('save-state:', body(false))).toEqual({ urn, saved: false });
    expect(saveChange('save-state:', body(true))).toEqual({ urn, saved: true });
  });

  it('ignores other requests', () => {
    expect(saveChange('feed', '{"saved":true}')).toEqual(null);
    // Mentions saving, but names neither a post nor a state.
    expect(saveChange('save-state:', '{"draft":"hello"}')).toBeNull();
  });

  it('keeps the state when the post is not named', () => {
    expect(saveChange('save-state:', '{"saved":true}')).toEqual({ urn: null, saved: true });
  });
});

describe('saveActionOfLabel', () => {
  it('recognises Save and Unsave controls', () => {
    expect(saveActionOfLabel('Save\nSave for later')).toBe('save');
    expect(saveActionOfLabel('  Unsave  ')).toBe('unsave');
    expect(saveActionOfLabel('Save post by Jane Doe')).toBe('save');
  });

  it('ignores everything else', () => {
    expect(saveActionOfLabel('Saved posts and articles')).toBeNull();
    expect(saveActionOfLabel('Like')).toBeNull();
    expect(saveActionOfLabel('')).toBeNull();
  });
});

describe('minimalPost', () => {
  it('links the post', () => {
    expect(minimalPost(URN_1)).toMatchObject({
      externalId: URN_1,
      url: `https://www.linkedin.com/feed/update/${URN_1}/`,
      title: 'LinkedIn post',
    });
  });
});

describe('isSignedOutResponse', () => {
  it('spots refusals and login pages', () => {
    expect(isSignedOutResponse(401, 'https://www.linkedin.com/voyager/api/graphql')).toBe(true);
    expect(isSignedOutResponse(200, 'https://www.linkedin.com/authwall?trk=x')).toBe(true);
    expect(isSignedOutResponse(200, 'https://www.linkedin.com/voyager/api/graphql')).toBe(false);
  });
});
