import { expect, signIn, test } from '../fixtures';

/**
 * A stand-in for www.linkedin.com, served by Playwright: the Voyager API's saved-posts list
 * and a feed, a saved-posts page that loads its list the way LinkedIn's does, and a feed page
 * whose Save button calls the save endpoint, so the real extension runs against it without
 * touching the network or a LinkedIn account.
 */
const CSRF = 'ajax:1234567890';
const QUERY_ID = 'voyagerSearchDashClusters.e2e';
const urn = (n: number) => `urn:li:activity:738000000000000000${n}`;
const LIVE = 9;

const result = (n: number, author: string, text: string) => ({
  $type: 'com.linkedin.voyager.dash.search.EntityResultViewModel',
  entityUrn: `urn:li:fsd_entityResultViewModel:(${urn(n)},SEARCH_MY_ITEMS_SAVED_POSTS,DEFAULT)`,
  navigationUrl: `https://www.linkedin.com/feed/update/${urn(n)}/`,
  title: { text: author },
  summary: { text },
});

const SAVED = [
  result(1, 'Jane Doe', 'Notes from our incident review'),
  result(2, 'Sam Lee', 'A short guide to design docs'),
  result(3, 'Kim Park', 'Hiring platform engineers in Lisbon'),
];
const LIVE_RESULT = result(LIVE, 'Ada Byte', 'Fresh take on code review');

/** A page of the saved list in LinkedIn's normalized shape. */
const savedPage = (items: ReturnType<typeof result>[], start: number, total: number) => ({
  data: {
    data: {
      searchDashClustersByAll: {
        paging: { start, count: 2, total },
        elements: [{ items: items.map((item) => ({ item: { '*entityResult': item.entityUrn } })) }],
      },
    },
  },
  included: items,
});

const FAKE_LINKEDIN_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>LinkedIn</title></head><body>
<button id="save">Save</button>
<button id="unsave">Unsave</button>
<script>
  const csrf = /JSESSIONID="?([^";]+)/.exec(document.cookie)[1];
  const headers = { 'csrf-token': csrf, accept: 'application/vnd.linkedin.normalized+json+2.1' };
  if (location.pathname.startsWith('/my-items/saved-posts')) {
    fetch('/voyager/api/graphql?variables=(start:0,query:(flagshipSearchIntent:SEARCH_MY_ITEMS_SAVED_POSTS))&queryId=${QUERY_ID}', { headers });
  } else {
    fetch('/voyager/api/graphql?variables=(start:0)&queryId=voyagerFeedDashMainFeed.e2e', { headers });
  }
  const call = (saved) =>
    fetch('/voyager/api/voyagerFeedDashSaveStates/' + encodeURIComponent('urn:li:fsd_saveState:(SAVE,${urn(LIVE)})'), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { $set: { saved } } }),
    });
  document.getElementById('save').onclick = () => call(true);
  document.getElementById('unsave').onclick = () => call(false);
</script>
</body></html>`;

test('LinkedIn: connecting imports your saved posts, then new saves sync live', async ({
  extensionContext,
}) => {
  let liveSaved = false;
  await extensionContext.route('https://www.linkedin.com/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) =>
      route.fulfill({
        contentType: 'application/vnd.linkedin.normalized+json+2.1',
        body: JSON.stringify(body),
      });
    if (url.pathname.startsWith('/voyager/api/')) {
      // LinkedIn refuses API requests without the session's CSRF token.
      if (request.headers()['csrf-token'] !== CSRF) {
        return route.fulfill({ status: 403, body: '{"status":403}' });
      }
      const variables = url.searchParams.get('variables') ?? '';
      if (variables.includes('SEARCH_MY_ITEMS_SAVED_POSTS')) {
        const all = liveSaved ? [LIVE_RESULT, ...SAVED] : SAVED;
        const start = Number(/start:(\d+)/.exec(variables)?.[1] ?? 0);
        return json(savedPage(all.slice(start, start + 2), start, all.length));
      }
      if (url.pathname.startsWith('/voyager/api/voyagerFeedDashSaveStates/')) {
        liveSaved = request.postData()?.includes('"saved":true') ?? false;
        return json({});
      }
      return json({
        included: [
          {
            $type: 'com.linkedin.voyager.dash.feed.Update',
            entityUrn: `urn:li:fsd_update:(${urn(LIVE)},MAIN_FEED,EMPTY,DEFAULT,false)`,
            metadata: { backendUrn: urn(LIVE) },
            actor: { name: { text: 'Ada Byte' } },
            commentary: { text: { text: 'Fresh take on code review' } },
          },
        ],
      });
    }
    return route.fulfill({ contentType: 'text/html', body: FAKE_LINKEDIN_PAGE });
  });

  // The extension's browser profile is shared with other tests: start signed out.
  await extensionContext.clearCookies();
  await extensionContext.addCookies([
    { name: 'JSESSIONID', value: CSRF, url: 'https://www.linkedin.com' },
  ]);
  const page = await extensionContext.newPage();
  await signIn(page, 'linkedin-connector@example.com');
  await page.goto('/extension/connect');
  await page.getByRole('button', { name: /connect extension/i }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();

  // Connect LinkedIn from Settings: the extension opens the saved-posts page and reads the list.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect LinkedIn' }).click();
  await expect(page.getByText('3 posts synced')).toBeVisible({ timeout: 45_000 });

  await page.goto('/inbox?source=linkedin');
  await expect(page.getByRole('article')).toHaveCount(3);
  const review = page.getByRole('article').filter({ hasText: 'Notes from our incident review' });
  await expect(review).toContainText('Jane Doe');
  await expect(review.getByRole('link')).toHaveAttribute(
    'href',
    `https://www.linkedin.com/feed/update/${urn(1)}/`,
  );

  // Saving a post anywhere on LinkedIn sends it straight away…
  const linkedin = await extensionContext.newPage();
  await linkedin.goto('https://www.linkedin.com/feed/');
  await linkedin.getByRole('button', { name: 'Save', exact: true }).click();
  const live = page.getByRole('link', { name: 'Fresh take on code review' });
  await expect(live).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(4);

  // …and unsaving it on LinkedIn removes it here.
  await linkedin.getByRole('button', { name: 'Unsave' }).click();
  await expect(live).toHaveCount(0);

  // Disconnecting stops the sync.
  await page.goto('/settings');
  await page.locator('#platforms').getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect LinkedIn' })).toBeVisible();
});
