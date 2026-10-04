import { describe, expect, it } from 'vitest';
import { learnSite } from './learn';
import { extractJsonPosts, isSiteRecipe, type PageLink } from './recipe';

const link = (href: string, text = '', extra: Partial<PageLink> = {}): PageLink => ({
  href,
  text,
  inNav: false,
  ...extra,
});
const nav = (href: string) => link(href, '', { inNav: true });

// ── Instagram-like: REST list, posts wrapped in `media`, grid of /p/{code}/ links ───────

const IG = 'https://www.instagram.com';
const igItem = (code: string, caption: string, user: string, takenAt: number) => ({
  media: {
    pk: `31${takenAt}`,
    code,
    taken_at: takenAt,
    caption: { text: caption },
    user: {
      username: user,
      full_name: `${user} Full`,
      profile_pic_url: `https://scontent.example/${user}.jpg`,
    },
    image_versions2: {
      candidates: [{ url: `https://scontent.cdninstagram.com/${code}.jpg`, width: 640 }],
    },
  },
});
const igSaved = {
  items: [
    igItem(
      'C9xYz12AbcD',
      'Five-minute pasta sauce that actually tastes like something',
      'chef.anna',
      1727000000,
    ),
    igItem(
      'DAbCdEfGh3k',
      'Morning light over the harbour, shot on film last week',
      'harbour.photo',
      1726000000,
    ),
    igItem(
      'C8qwErTy9Uz',
      'Thread: how we cut our cloud bill in half without rewriting',
      'dev.notes',
      1725000000,
    ),
  ],
  more_available: true,
  next_max_id: 'QVFE...',
};
const igLinks = [
  nav(`${IG}/`),
  nav(`${IG}/explore/`),
  link(`${IG}/me/`),
  link(`${IG}/p/C9xYz12AbcD/`),
  link(`${IG}/p/DAbCdEfGh3k/`),
  link(`${IG}/reel/C8qwErTy9Uz/`),
  link(`${IG}/p/C8qwErTy9Uz/`),
];

describe('learnSite: Instagram-like', () => {
  const result = learnSite({
    pageUrl: `${IG}/me/saved/all-posts/`,
    label: 'Instagram',
    links: igLinks,
    captures: [
      {
        source: 'profile',
        json: { user: { username: 'me', biography: 'Hello there, this is me' } },
      },
      { source: 'feed/saved/posts', json: igSaved },
    ],
  });

  it('finds the saved list in the loaded data and maps its fields', () => {
    expect(result.report.method).toBe('json');
    expect(result.report.chosen).toMatchObject({
      // /p/… and /reel/… links form one shape; links are built with the common /p/.
      shape: '/{any}/{id}/',
      fields: {
        id: 'media.code',
        text: 'media.caption.text',
        handle: 'media.user.username',
        authorName: 'media.user.full_name',
        image: 'media.image_versions2.candidates.0.url',
        postedAt: 'media.taken_at (seconds)',
      },
    });
    expect(isSiteRecipe(result.recipe)).toBe(true);
  });

  it('turns every saved item into a post, with a working link', () => {
    expect(result.posts).toHaveLength(3);
    expect(result.posts[0]).toEqual({
      externalId: 'C9xYz12AbcD',
      url: 'https://www.instagram.com/p/C9xYz12AbcD/',
      title: 'Five-minute pasta sauce that actually tastes like something',
      author: 'chef.anna Full (@chef.anna)',
      thumbnailUrl: 'https://scontent.cdninstagram.com/C9xYz12AbcD.jpg',
      postedAt: '2024-09-22T10:13:20.000Z',
      metadata: { learned: true, postedAt: '2024-09-22T10:13:20.000Z' },
    });
  });

  it('keeps working when the next page arrives in a different wrapper', () => {
    const nextPage = { data: { saved: igSaved.items.slice(0, 1) } };
    const posts = extractJsonPosts(result.recipe!.json!, nextPage, {
      pageUrl: `${IG}/me/saved/all-posts/`,
      label: 'Instagram',
    });
    expect(posts.map((post) => post.externalId)).toEqual(['C9xYz12AbcD']);
  });
});

// ── LinkedIn-like: normalised `included` array mixing posts and profiles ─────────────

const LI = 'https://www.linkedin.com';
const activity = (n: number) => `urn:li:activity:72400000000000000${n}`;
const liUpdate = (n: number, text: string, actor: string) => ({
  $type: 'com.linkedin.voyager.feed.render.UpdateV2',
  entityUrn: `urn:li:fs_updateV2:(${activity(n)},SAVED_ITEMS)`,
  actor: { name: { text: actor }, description: { text: `${actor} works on interesting things` } },
  commentary: { text: { text } },
});
const liProfile = (id: string) => ({
  $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
  publicIdentifier: id,
  firstName: 'Some',
  lastName: 'Person',
});
const liLinks = [
  nav(`${LI}/feed/`),
  link(`${LI}/in/jane-doe-4a1b2c3/`),
  link(`${LI}/in/sam-lee-9z8y7x6/`),
  link(`${LI}/in/kim-park-1q2w3e/`),
  link(`${LI}/feed/update/${activity(1)}/`),
  link(`${LI}/feed/update/${activity(2)}/`),
  link(`${LI}/feed/update/${activity(3)}/`),
];

describe('learnSite: LinkedIn-like', () => {
  const result = learnSite({
    pageUrl: `${LI}/my-items/saved-posts/`,
    label: 'LinkedIn',
    links: liLinks,
    captures: [
      {
        source: 'voyager/graphql',
        json: {
          data: { paging: { count: 10 } },
          included: [
            liProfile('jane-doe-4a1b2c3'),
            liUpdate(1, 'We are hiring platform engineers in Lisbon, remote friendly', 'Jane Doe'),
            liProfile('sam-lee-9z8y7x6'),
            liUpdate(2, 'Notes from our incident review: what went right and wrong', 'Sam Lee'),
            liUpdate(3, 'A short guide to writing design docs people actually read', 'Kim Park'),
            liProfile('kim-park-1q2w3e'),
          ],
        },
      },
    ],
  });

  it('picks posts over profile links, unwraps ids from URNs and filters the mixed list', () => {
    expect(result.report.method).toBe('json');
    expect(result.recipe?.json).toMatchObject({
      itemFilter: { path: ['$type'], equals: 'com.linkedin.voyager.feed.render.UpdateV2' },
      fields: {
        id: { path: ['entityUrn'], prefix: 'urn:li:fs_updateV2:(', suffix: ',SAVED_ITEMS)' },
        text: ['commentary', 'text', 'text'],
        authorName: ['actor', 'name', 'text'],
      },
    });
    expect(result.posts.map((post) => post.url)).toEqual([
      `${LI}/feed/update/${activity(1)}/`,
      `${LI}/feed/update/${activity(2)}/`,
      `${LI}/feed/update/${activity(3)}/`,
    ]);
    expect(result.posts[1]).toMatchObject({
      externalId: activity(2),
      title: 'Notes from our incident review: what went right and wrong',
      author: 'Sam Lee',
    });
  });
});

// ── Reddit-like: listing with permalinks; one id has no digits ──────────────────────────

const RD = 'https://www.reddit.com';
const rdPost = (id: string, sub: string, slug: string, title: string, selftext: string) => ({
  kind: 't3',
  data: {
    id,
    name: `t3_${id}`,
    title,
    selftext,
    author: `${sub}_fan`,
    subreddit: sub,
    permalink: `/r/${sub}/comments/${id}/${slug}/`,
    created_utc: 1727000000.0,
    url: `https://example.org/${slug}`,
  },
});

describe('learnSite: Reddit-like', () => {
  const posts = [
    rdPost(
      '1abcde',
      'programming',
      'why_is_my_build_slow',
      'Why is my build slow?',
      'It takes ten minutes to compile a hello world project.',
    ),
    rdPost(
      'xyzabc',
      'rust',
      'borrow_checker_tips',
      'Borrow checker tips',
      'Collected advice from the last few years of fighting it.',
    ),
    rdPost(
      '2fghij',
      'cooking',
      'best_knife',
      'Best first knife?',
      'Looking for a durable chef knife that will not break the bank.',
    ),
  ];
  const result = learnSite({
    pageUrl: `${RD}/user/me/saved/`,
    label: 'Reddit',
    links: [
      link(`${RD}/r/programming/`),
      link(`${RD}/r/rust/`),
      ...posts.map(({ data }) => link(`${RD}${data.permalink}`, data.title)),
    ],
    captures: [{ source: 'saved.json', json: { kind: 'Listing', data: { children: posts } } }],
  });

  it('uses the permalink field and separates the title from the body', () => {
    expect(result.report.chosen?.fields).toMatchObject({
      id: 'data.id',
      link: 'data.permalink',
      title: 'data.title',
      text: 'data.selftext',
      handle: 'data.author',
      postedAt: 'data.created_utc (seconds)',
    });
    expect(result.posts.map((post) => post.externalId)).toEqual(['1abcde', 'xyzabc', '2fghij']);
    expect(result.posts[1]).toMatchObject({
      url: `${RD}/r/rust/comments/xyzabc/borrow_checker_tips/`,
      title: 'Borrow checker tips',
      text: 'Collected advice from the last few years of fighting it.',
      author: '@rust_fan',
    });
  });
});

// ── A site that loads no data: links only ────────────────────────────────────────────────

describe('learnSite: links only', () => {
  const SITE = 'https://pinboard.example';
  it('falls back to the post links and the text around them', () => {
    const result = learnSite({
      pageUrl: `${SITE}/me/saved`,
      label: 'pinboard.example',
      captures: [],
      links: [
        nav(`${SITE}/me`),
        link(`${SITE}/pin/123456789/`, '', {
          cardText: 'Japanese joinery basics\nSaved 2 days ago',
          image: 'https://img.pinboard.example/1.jpg',
        }),
        link(`${SITE}/pin/223456789/`, 'A very long link title about sourdough'),
        link(`${SITE}/pin/323456789/`, '', { cardText: 'Garden plans for spring' }),
      ],
    });
    expect(result.report.method).toBe('dom');
    expect(result.recipe).toEqual({
      version: 1,
      dom: {
        shape: { parts: [{ kind: 'lit', value: 'pin' }, { kind: 'id' }], trailingSlash: true },
      },
    });
    expect(result.posts).toHaveLength(3);
    expect(result.posts[0]).toMatchObject({
      externalId: '123456789',
      url: `${SITE}/pin/123456789/`,
      title: 'Japanese joinery basics Saved 2 days ago',
      thumbnailUrl: 'https://img.pinboard.example/1.jpg',
    });
    expect(result.posts[1]).toMatchObject({ title: 'A very long link title about sourdough' });
  });

  it('explains when the page has no post links', () => {
    const result = learnSite({
      pageUrl: `${SITE}/settings`,
      label: 'pinboard.example',
      captures: [],
      links: [link(`${SITE}/about`), link(`${SITE}/help`)],
    });
    expect(result.recipe).toBeNull();
    expect(result.report.problem).toMatch(/Couldn't find links to individual posts/);
  });
});

describe('isSiteRecipe', () => {
  it('rejects malformed recipes', () => {
    expect(isSiteRecipe(null)).toBe(false);
    expect(isSiteRecipe({ version: 2, dom: { shape: { parts: [] } } })).toBe(false);
    expect(isSiteRecipe({ version: 1 })).toBe(false);
    expect(isSiteRecipe({ version: 1, dom: { shape: { parts: [{ kind: 'eval' }] } } })).toBe(false);
  });
});
