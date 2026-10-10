import { expect, signIn, test } from '../fixtures';

/**
 * A stand-in for www.instagram.com, served by Playwright: the web API's saved feed and media
 * info, and a page whose Save button calls the endpoint Instagram's web app calls, so the
 * real extension runs against it without touching the network or an Instagram account.
 */
const media = (n: number, data: Record<string, unknown> = {}) => ({
  id: `345678901234567890${n}_25025320`,
  pk: Number(`345678901234567890${n}`),
  code: `DPost00000${n}`,
  media_type: 1,
  taken_at: 1759100000 - n * 1000,
  user: { username: 'chef_anna', full_name: 'Anna' },
  image_versions2: { candidates: [{ url: `https://scontent.cdninstagram.com/v/${n}.jpg` }] },
  ...data,
});

const SAVED_FIRST = [
  media(1, { caption: { text: 'Sunday market haul' } }),
  media(2, { caption: { text: 'Five-minute tomato sauce' }, product_type: 'clips', media_type: 2 }),
];
const SAVED_LAST = [media(3, { caption: { text: 'Knife skills, part one' } })];
const LIVE = 9;

const FAKE_INSTAGRAM_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Instagram</title></head><body>
<button id="save">Save</button>
<button id="unsave">Remove</button>
<script>
  const call = (action) =>
    fetch('/api/v1/web/save/345678901234567890${LIVE}/' + action + '/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ container_module: 'feed_timeline' }),
    });
  document.getElementById('save').onclick = () => call('save');
  document.getElementById('unsave').onclick = () => call('unsave');
</script>
</body></html>`;

test('Instagram: connecting imports your saved posts, then new saves sync live', async ({
  extensionContext,
}) => {
  let liveSaved = false;
  await extensionContext.route('https://www.instagram.com/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/api/v1/')) {
      // Instagram's API refuses requests without the web app's id.
      if (!request.headers()['x-ig-app-id'] && !url.pathname.includes('/web/save/')) {
        return route.fulfill({ status: 400, body: '{"message":"useragent mismatch"}' });
      }
    }
    if (url.pathname === '/api/v1/feed/saved/posts/') {
      return json(
        url.searchParams.get('max_id')
          ? { items: SAVED_LAST.map((m) => ({ media: m })), more_available: false, status: 'ok' }
          : {
              items: SAVED_FIRST.map((m) => ({ media: m })),
              more_available: true,
              next_max_id: 'QVFE-next',
              status: 'ok',
            },
      );
    }
    if (url.pathname === `/api/v1/media/345678901234567890${LIVE}/info/`) {
      return json({
        items: [
          media(LIVE, { caption: { text: 'Fresh pasta at home' }, has_viewer_saved: liveSaved }),
        ],
        status: 'ok',
      });
    }
    const save = /\/web\/save\/\d+\/(save|unsave)\/$/.exec(url.pathname);
    if (save) {
      liveSaved = save[1] === 'save';
      return json({ status: 'ok' });
    }
    return route.fulfill({ contentType: 'text/html', body: FAKE_INSTAGRAM_PAGE });
  });

  // The extension's browser profile is shared with other tests: start signed out.
  await extensionContext.clearCookies();
  const page = await extensionContext.newPage();
  await signIn(page, 'instagram-connector@example.com');
  await page.goto('/extension/connect');
  await page.getByRole('button', { name: /connect extension/i }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();

  // Connect Instagram from Settings: the extension opens Instagram and reads the saved list.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect Instagram' }).click();
  await expect(page.getByText('3 posts synced')).toBeVisible({ timeout: 45_000 });

  await page.goto('/inbox?source=instagram');
  await expect(page.getByRole('article')).toHaveCount(3);
  const haul = page.getByRole('article').filter({ hasText: 'Sunday market haul' });
  await expect(haul).toContainText('Anna (@chef_anna)');
  await expect(haul.getByRole('link')).toHaveAttribute(
    'href',
    'https://www.instagram.com/p/DPost000001/',
  );
  await expect(page.getByRole('link', { name: 'Five-minute tomato sauce' })).toHaveAttribute(
    'href',
    'https://www.instagram.com/reel/DPost000002/',
  );

  // Saving a post anywhere on Instagram sends it straight away…
  const instagram = await extensionContext.newPage();
  await instagram.goto('https://www.instagram.com/');
  await instagram.getByRole('button', { name: 'Save', exact: true }).click();
  const live = page.getByRole('link', { name: 'Fresh pasta at home' });
  await expect(live).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(4);

  // …and removing it from saved on Instagram removes it here.
  await instagram.getByRole('button', { name: 'Remove' }).click();
  await expect(live).toHaveCount(0);

  // Disconnecting stops the sync.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Instagram' })).toBeVisible();
});
