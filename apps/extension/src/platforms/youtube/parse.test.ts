import { describe, expect, it } from 'vitest';
import {
  browseRequestTarget,
  extractVideos,
  isSuccessfulEdit,
  parseOembed,
  parseWatchLaterEdit,
  parseWatchLaterPage,
} from './parse';

describe('browseRequestTarget', () => {
  it('tells Watch later from other pages and continuations', () => {
    const context = { client: { clientName: 'WEB' } };
    expect(browseRequestTarget(JSON.stringify({ context, browseId: 'VLWL' }))).toBe('watch-later');
    expect(browseRequestTarget(JSON.stringify({ context, browseId: 'FEwhat_to_watch' }))).toBe(
      'other-page',
    );
    expect(browseRequestTarget(JSON.stringify({ context, continuation: '4qmFsgK' }))).toBe(
      'continuation',
    );
    expect(browseRequestTarget(undefined)).toBeNull();
    expect(browseRequestTarget('not json')).toBeNull();
  });
});

/** A playlist item as YouTube sends it since 2025 (trimmed from a real response). */
const lockup = (id: string, title: string, channel: string) => ({
  lockupViewModel: {
    contentId: id,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: {
      thumbnailViewModel: {
        image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg?sqp=x&rs=y` }] },
        overlays: [
          {
            thumbnailBottomOverlayViewModel: {
              badges: [{ thumbnailBadgeViewModel: { text: '27:24' } }],
            },
          },
        ],
      },
    },
    metadata: {
      lockupMetadataViewModel: {
        title: { content: title },
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [
              { metadataParts: [{ text: { content: channel } }] },
              {
                metadataParts: [
                  { text: { content: '12K views' } },
                  { text: { content: '2 days ago' } },
                ],
              },
            ],
          },
        },
      },
    },
    rendererContext: {
      commandContext: {
        onTap: { innertubeCommand: { watchEndpoint: { setVideoId: `set-${id}` } } },
      },
    },
  },
});

/** The older playlist item shape. */
const playlistVideo = (id: string, data: Record<string, unknown> = {}) => ({
  playlistVideoRenderer: {
    videoId: id,
    setVideoId: `set-${id}`,
    title: { runs: [{ text: 'Postgres indexes, ' }, { text: 'explained' }] },
    shortBylineText: { runs: [{ text: 'Hussein Nasser' }] },
    lengthText: { simpleText: '1:02:03' },
    isPlayable: true,
    ...data,
  },
});

const firstPage = {
  contents: {
    sectionListRenderer: {
      contents: [
        {
          itemSectionRenderer: {
            contents: [
              lockup('nRLZqaNOrwQ', 'Build creative apps with GenMedia', 'Google for Developers'),
              playlistVideo('aB3dE5gH7jK'),
              playlistVideo('zzzzzzzzzzz', {
                isPlayable: false,
                title: { simpleText: '[Private video]' },
              }),
              { continuationItemViewModel: { continuationCommand: { token: 'next' } } },
            ],
          },
        },
      ],
    },
  },
};

describe('parseWatchLaterPage', () => {
  it('reads both item shapes, skipping private videos, and sees that more follow', () => {
    const page = parseWatchLaterPage(firstPage);
    expect(page.hasMore).toBe(true);
    expect(page.videos).toEqual([
      {
        post: {
          externalId: 'nRLZqaNOrwQ',
          url: 'https://www.youtube.com/watch?v=nRLZqaNOrwQ',
          title: 'Build creative apps with GenMedia',
          author: 'Google for Developers',
          thumbnailUrl: 'https://i.ytimg.com/vi/nRLZqaNOrwQ/hqdefault.jpg',
          metadata: { channel: 'Google for Developers', duration: '27:24' },
        },
        setVideoId: 'set-nRLZqaNOrwQ',
      },
      {
        post: expect.objectContaining({
          externalId: 'aB3dE5gH7jK',
          title: 'Postgres indexes, explained',
          author: 'Hussein Nasser',
          metadata: { channel: 'Hussein Nasser', duration: '1:02:03' },
        }) as unknown,
        setVideoId: 'set-aB3dE5gH7jK',
      },
    ]);
  });

  it('ends at a page without a continuation', () => {
    const last = {
      onResponseReceivedActions: [
        { appendContinuationItemsAction: { continuationItems: [playlistVideo('aB3dE5gH7jK')] } },
      ],
    };
    expect(parseWatchLaterPage(last).hasMore).toBe(false);
    expect(parseWatchLaterPage(null)).toEqual({ videos: [], hasMore: false, empty: false });
  });

  /** An empty Watch later as YouTube sends it (trimmed from a real response). */
  const emptyPage = (
    message: unknown = { messageRenderer: { text: { runs: [{ text: 'Leer' }] } } },
  ) => ({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [{ itemSectionRenderer: { contents: [message] } }],
                },
              },
            },
          },
        ],
      },
    },
    header: { playlistHeaderRenderer: { playlistId: 'WL', title: { simpleText: 'Watch later' } } },
  });

  it('says the list is empty only when YouTube says so, in any language', () => {
    expect(parseWatchLaterPage(emptyPage())).toEqual({ videos: [], hasMore: false, empty: true });
    expect(parseWatchLaterPage(firstPage).empty).toBe(false);
  });

  it('does not take a page it cannot read for an empty list', () => {
    // Items in a shape this parser doesn't know: no videos read, but no message either.
    expect(parseWatchLaterPage(emptyPage({ someNewVideoViewModel: { id: 'x' } })).empty).toBe(
      false,
    );
    // Another playlist's empty page.
    const other = { ...emptyPage(), header: { playlistHeaderRenderer: { playlistId: 'PLabc' } } };
    expect(parseWatchLaterPage(other).empty).toBe(false);
    // A header in a shape this parser doesn't know.
    expect(parseWatchLaterPage({ ...emptyPage(), header: { pageHeaderViewModel: {} } }).empty).toBe(
      false,
    );
  });
});

describe('extractVideos', () => {
  it('ignores playlists, channels and invalid ids', () => {
    const feed = [
      { lockupViewModel: { contentId: 'PLabc', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
      { videoRenderer: { videoId: 'not-an-id' } },
      { videoRenderer: { videoId: 'Qw3rTy12345', title: { runs: [{ text: 'Home feed video' }] } } },
    ];
    expect(extractVideos(feed).map((video) => video.post.title)).toEqual(['Home feed video']);
  });
});

describe('parseWatchLaterEdit', () => {
  const body = (value: unknown) => JSON.stringify(value);

  it('reads adds and removes on Watch later', () => {
    expect(
      parseWatchLaterEdit(
        body({
          playlistId: 'WL',
          actions: [{ addedVideoId: 'nRLZqaNOrwQ', action: 'ACTION_ADD_VIDEO' }],
        }),
      ),
    ).toEqual({ added: ['nRLZqaNOrwQ'], removed: [], removedEntries: [] });
    expect(
      parseWatchLaterEdit(
        body({
          playlistId: 'WL',
          actions: [
            { removedVideoId: 'nRLZqaNOrwQ', action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' },
            { setVideoId: 'set-aB3dE5gH7jK', action: 'ACTION_REMOVE_VIDEO' },
          ],
        }),
      ),
    ).toEqual({ added: [], removed: ['nRLZqaNOrwQ'], removedEntries: ['set-aB3dE5gH7jK'] });
  });

  it('ignores other playlists and anything unreadable', () => {
    expect(
      parseWatchLaterEdit(
        body({
          playlistId: 'PLmine',
          actions: [{ addedVideoId: 'nRLZqaNOrwQ', action: 'ACTION_ADD_VIDEO' }],
        }),
      ),
    ).toBeNull();
    expect(parseWatchLaterEdit('not json')).toBeNull();
    expect(parseWatchLaterEdit(undefined)).toBeNull();
  });
});

describe('isSuccessfulEdit', () => {
  it('checks the status InnerTube reports', () => {
    expect(isSuccessfulEdit(200, { status: 'STATUS_SUCCEEDED' })).toBe(true);
    expect(isSuccessfulEdit(200, { status: 'STATUS_FAILED' })).toBe(false);
    expect(isSuccessfulEdit(500, null)).toBe(false);
  });
});

describe('parseOembed', () => {
  it('fills in title and channel, with a placeholder when unavailable', () => {
    expect(
      parseOembed('nRLZqaNOrwQ', { title: 'A talk', author_name: 'Google for Developers' }),
    ).toMatchObject({
      title: 'A talk',
      author: 'Google for Developers',
    });
    expect(parseOembed('nRLZqaNOrwQ', null).title).toBe('YouTube video');
  });
});
