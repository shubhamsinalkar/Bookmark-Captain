import { expect, signIn, test } from '../fixtures';

/**
 * A stand-in for www.reddit.com, served by Playwright: Reddit's JSON listings for the saved
 * list, and a page whose Save buttons send the GraphQL mutation Reddit's web app sends, so
 * the real extension runs against it without touching the network or a Reddit account.
 */
const thing = (kind: 't1' | 't3', id: string, data: Record<string, unknown>) => ({
  kind,
  data: {
    name: `${kind}_${id}`,
    author: 'mriidicc',
    subreddit_name_prefixed: 'r/developersIndia',
    permalink: `/r/developersIndia/comments/${id}/`,
    created_utc: 1759100000,
    ...data,
  },
});

const SAVED_FIRST = [
  thing('t3', 'aa1', { title: 'Got laid off on bday', selftext: 'Prepping for interviews.' }),
  thing('t3', 'aa2', { title: 'I finally got 3 offers after 5 months', selftext: 'Keep at it.' }),
];
const SAVED_LAST = [
  thing('t1', 'cc3', { body: 'Use a partial index.', link_title: 'Slow query on a big table' }),
];
const LIVE_ID = 'live9';
const listing = (children: unknown[], after: string | null) =>
  JSON.stringify({ kind: 'Listing', data: { after, children } });

const FAKE_REDDIT_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Reddit</title></head><body>
<button id="save">Save</button>
<button id="unsave">Remove from saved</button>
<script>
  const mutate = (saveState) =>
    fetch('/svc/shreddit/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operation: 'UpdatePostSaveState',
        variables: { input: { postId: 't3_${LIVE_ID}', saveState } },
        csrf_token: 'token',
      }),
    });
  document.getElementById('save').onclick = () => mutate('SAVED');
  document.getElementById('unsave').onclick = () => mutate('NONE');
</script>
</body></html>`;

test('Reddit: connecting imports your saved list, then new saves sync live', async ({
  extensionContext,
}) => {
  let liveSaved = false;
  await extensionContext.route('https://www.reddit.com/**', (route) => {
    const url = new URL(route.request().url());
    const json = (body: string) => route.fulfill({ contentType: 'application/json', body });
    switch (url.pathname) {
      case '/api/me.json':
        return json(JSON.stringify({ kind: 't2', data: { name: 'e2e_user' } }));
      case '/user/e2e_user/saved.json':
        return json(
          url.searchParams.get('after')
            ? listing(SAVED_LAST, null)
            : listing(SAVED_FIRST, 't3_aa2'),
        );
      case '/api/info.json':
        return json(
          listing(
            [thing('t3', LIVE_ID, { title: 'Ship small changes, often', saved: liveSaved })],
            null,
          ),
        );
      case '/svc/shreddit/graphql': {
        liveSaved = route.request().postData()?.includes('"SAVED"') ?? false;
        return json(JSON.stringify({ data: { updatePostSaveState: { ok: true } } }));
      }
      default:
        return route.fulfill({ contentType: 'text/html', body: FAKE_REDDIT_PAGE });
    }
  });

  // The extension's browser profile is shared with other tests: start signed out.
  await extensionContext.clearCookies();
  const page = await extensionContext.newPage();
  await signIn(page, 'reddit-connector@example.com');
  await page.goto('/extension/connect');
  await page.getByRole('button', { name: /connect extension/i }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();

  // Connect Reddit from Settings: the extension opens your saved page and reads the list.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect Reddit' }).click();
  await expect(page.getByText('3 posts synced')).toBeVisible({ timeout: 45_000 });

  await page.goto('/inbox?source=reddit');
  await expect(page.getByRole('article')).toHaveCount(3);
  const laidOff = page.getByRole('article').filter({ hasText: 'Got laid off on bday' });
  await expect(laidOff).toContainText('u/mriidicc');
  await expect(laidOff.getByRole('link')).toHaveAttribute(
    'href',
    'https://www.reddit.com/r/developersIndia/comments/aa1/',
  );
  await expect(
    page.getByRole('link', { name: 'Comment on “Slow query on a big table”' }),
  ).toBeVisible();

  // Saving a post anywhere on Reddit sends it straight away…
  const reddit = await extensionContext.newPage();
  await reddit.goto('https://www.reddit.com/r/developersIndia/');
  await reddit.getByRole('button', { name: 'Save', exact: true }).click();
  const live = page.getByRole('link', { name: 'Ship small changes, often' });
  await expect(live).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(4);

  // …and unsaving it on Reddit removes it here.
  await reddit.getByRole('button', { name: 'Remove from saved' }).click();
  await expect(live).toHaveCount(0);

  // Disconnecting stops the sync.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Reddit' })).toBeVisible();
});
