import { expect, signIn, test } from '../fixtures';

/**
 * A stand-in for www.youtube.com, served by Playwright: a Watch later page that embeds its
 * first page as `ytInitialData` and loads the rest through InnerTube as you scroll, and a
 * page whose Watch later buttons send the `edit_playlist` request YouTube's web app sends.
 */
const lockup = (id: string, title: string) => ({
  lockupViewModel: {
    contentId: id,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    metadata: {
      lockupMetadataViewModel: {
        title: { content: title },
        metadata: {
          contentMetadataViewModel: {
            metadataRows: [{ metadataParts: [{ text: { content: 'Fireship' } }] }],
          },
        },
      },
    },
  },
});

const RUST = lockup('aaaaaaaaaa1', 'Rust in 100 seconds');
const FRAMEWORKS = lockup('aaaaaaaaaa2', 'I tried every web framework');
const LAST_PAGE = {
  onResponseReceivedActions: [
    {
      appendContinuationItemsAction: {
        continuationItems: [
          {
            playlistVideoRenderer: {
              videoId: 'aaaaaaaaaa3',
              title: { runs: [{ text: 'Postgres in 100 seconds' }] },
              shortBylineText: { runs: [{ text: 'Fireship' }] },
              isPlayable: true,
            },
          },
        ],
      },
    },
  ],
};
/** The home feed: never Watch later, even when it loads while the address still says so. */
const HOME_FEED = {
  contents: [
    lockup('homeVideo01', 'Trending on the home page'),
    { continuationItemViewModel: { continuationCommand: { token: 'home-more' } } },
  ],
};
const LIVE = 'liveVideo01';

/** Like YouTube's web app: `fetch(Request)`, with the body inside the Request. */
const innertube = (path: string, body: unknown) =>
  `fetch(new Request('/youtubei/v1/${path}?prettyPrint=false', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }))`;

const watchLaterPage = (items: unknown[]) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Watch later - YouTube</title></head><body>
<script>var ytInitialData = ${JSON.stringify({
  contents: [...items, { continuationItemViewModel: { continuationCommand: { token: 'more' } } }],
})};</script>
<button id="home">Home</button>
<div style="height: 4000px"></div>
<script>
  let more = false;
  addEventListener('scroll', () => {
    if (more) return;
    more = true;
    ${innertube('browse', { continuation: 'more' })};
  });
  // YouTube switches pages without reloading, loading the new page before the address changes.
  document.getElementById('home').onclick = () =>
    ${innertube('browse', { browseId: 'FEwhat_to_watch' })};
</script>
</body></html>`;

const HOME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>YouTube</title></head><body>
<button id="add">Watch later</button>
<button id="remove">Remove from Watch later</button>
<script>
  document.getElementById('add').onclick = () =>
    ${innertube('browse/edit_playlist', { playlistId: 'WL', actions: [{ addedVideoId: LIVE, action: 'ACTION_ADD_VIDEO' }] })};
  document.getElementById('remove').onclick = () =>
    ${innertube('browse/edit_playlist', { playlistId: 'WL', actions: [{ removedVideoId: LIVE, action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID' }] })};
</script>
</body></html>`;

test('YouTube: connecting imports Watch later, then changes sync live and on every check', async ({
  extensionContext,
}) => {
  let firstPage = [RUST, FRAMEWORKS];
  await extensionContext.route('https://www.youtube.com/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    switch (url.pathname) {
      case '/playlist':
        return route.fulfill({ contentType: 'text/html', body: watchLaterPage(firstPage) });
      case '/youtubei/v1/browse':
        return json(request.postData()?.includes('FEwhat_to_watch') ? HOME_FEED : LAST_PAGE);
      case '/youtubei/v1/browse/edit_playlist':
        return json({ status: 'STATUS_SUCCEEDED' });
      case '/oembed':
        return json({ title: 'How DNS works', author_name: 'ByteByteGo' });
      default:
        return route.fulfill({ contentType: 'text/html', body: HOME_PAGE });
    }
  });

  // The extension's browser profile is shared with other tests: start signed out.
  await extensionContext.clearCookies();
  const page = await extensionContext.newPage();
  await signIn(page, 'youtube-connector@example.com');
  await page.goto('/extension/connect');
  await page.getByRole('button', { name: /connect extension/i }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();

  // Connect YouTube from Settings: the extension opens Watch later and reads it.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect YouTube' }).click();
  await expect(page.getByText('3 posts synced')).toBeVisible({ timeout: 45_000 });

  await page.goto('/inbox?source=youtube');
  await expect(page.getByRole('article')).toHaveCount(3);
  const rust = page.getByRole('article').filter({ hasText: 'Rust in 100 seconds' });
  await expect(rust).toContainText('Fireship');
  await expect(rust.getByRole('link')).toHaveAttribute(
    'href',
    'https://www.youtube.com/watch?v=aaaaaaaaaa1',
  );
  await expect(page.getByRole('link', { name: 'Postgres in 100 seconds' })).toBeVisible();

  // Leaving Watch later for the home page: the home feed is not Watch later.
  const watchLater = await extensionContext.newPage();
  await watchLater.goto('https://www.youtube.com/playlist?list=WL');
  await watchLater.getByRole('button', { name: 'Home' }).click();

  // Adding a video to Watch later anywhere on YouTube sends it straight away…
  const youtube = await extensionContext.newPage();
  await youtube.goto('https://www.youtube.com/');
  await youtube.getByRole('button', { name: 'Watch later', exact: true }).click();
  const live = page.getByRole('link', { name: 'How DNS works' });
  await expect(live).toBeVisible();
  // (Four: the home feed video was not imported.)
  await expect(page.getByRole('article')).toHaveCount(4);

  // …and taking it out removes it here.
  await youtube.getByRole('button', { name: 'Remove from Watch later' }).click();
  await expect(live).toHaveCount(0);

  // Taken out of Watch later elsewhere (say, on a phone): gone after the next check.
  firstPage = [RUST];
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('2 posts synced')).toBeVisible({ timeout: 45_000 });
  await page.goto('/inbox?source=youtube');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'I tried every web framework' })).toHaveCount(0);

  // Disconnecting stops the sync.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect YouTube' })).toBeVisible();
});
