import { readFileSync } from 'node:fs';
import { expect, signIn, test } from '../fixtures';

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../apps/extension/src/platforms/x/fixtures/${name}.json`, import.meta.url),
    'utf8',
  );

/**
 * A stand-in for x.com, served by Playwright: just enough page to make the same GraphQL
 * calls X's web app makes (fetch for timelines, XHR for bookmark mutations), so the real
 * extension runs against it without touching the network or an X account.
 */
const FAKE_X_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>X</title></head><body>
<button id="bookmark" hidden>Bookmark</button>
<button id="unbookmark">Remove bookmark</button>
<div style="height: 4000px"></div>
<script>
  const gql = (op) => '/i/api/graphql/aB3_x9/' + op;
  if (location.pathname.startsWith('/i/bookmarks')) {
    fetch(gql('Bookmarks') + '?variables=%7B%7D');
    let more = false;
    addEventListener('scroll', () => {
      if (more) return;
      more = true;
      fetch(gql('Bookmarks') + '?variables=%7B%22cursor%22%3A%22next%22%7D');
    });
  } else {
    fetch(gql('HomeTimeline'))
      .then((response) => response.json())
      .then(() => (document.getElementById('bookmark').hidden = false));
  }
  const mutate = (op) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', gql(op));
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.send(JSON.stringify({ variables: { tweet_id: '1972600000000000004' }, queryId: 'q' }));
  };
  document.getElementById('bookmark').onclick = () => mutate('CreateBookmark');
  document.getElementById('unbookmark').onclick = () => mutate('DeleteBookmark');
</script>
</body></html>`;

test('X: connecting imports your bookmarks, then new saves sync live', async ({
  extensionContext,
}) => {
  await extensionContext.route('https://x.com/**', (route) => {
    const url = new URL(route.request().url());
    const op = /\/i\/api\/graphql\/[^/]+\/(\w+)/.exec(url.pathname)?.[1];
    if (!op) return route.fulfill({ contentType: 'text/html', body: FAKE_X_PAGE });
    const body =
      op === 'Bookmarks'
        ? fixture(url.search.includes('cursor') ? 'bookmarks-end' : 'bookmarks-page')
        : op === 'HomeTimeline'
          ? fixture('home-timeline')
          : JSON.stringify({ data: { done: true } });
    return route.fulfill({ contentType: 'application/json', body });
  });

  // The extension's browser profile is shared with other tests: start signed out.
  await extensionContext.clearCookies();
  const page = await extensionContext.newPage();
  await signIn(page, 'x-connector@example.com');
  await page.goto('/extension/connect');
  await page.getByRole('button', { name: /connect extension/i }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();

  // Connect X from Settings: the extension opens x.com/i/bookmarks and imports it.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect X' }).click();
  // Allows for one reload by the check-in safety net (15 s) on a slow run.
  await expect(page.getByText('2 posts synced')).toBeVisible({ timeout: 45_000 });

  await page.goto('/inbox?source=x');
  const reply = page.getByRole('article').filter({ hasText: 'Thanks, found the original thread' });
  await expect(reply).toContainText('charan (@xpcharan)');
  await expect(reply.getByRole('link')).toHaveAttribute(
    'href',
    'https://x.com/xpcharan/status/1972900000000000001',
  );
  await expect(
    page.getByRole('link', { name: /^Completely free 6-month curriculum/ }),
  ).toBeVisible();
  // Neither the deleted post nor the quoted one was imported.
  await expect(page.getByRole('article')).toHaveCount(2);

  // Bookmarking a post anywhere on X sends it straight away, with its content…
  const home = await extensionContext.newPage();
  await home.goto('https://x.com/home');
  await home.getByRole('button', { name: 'Bookmark', exact: true }).click();
  const live = page.getByRole('link', { name: 'Ship small <changes>, ship them often.' });
  await expect(live).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);

  // …and removing the bookmark on X removes it here.
  await home.getByRole('button', { name: 'Remove bookmark' }).click();
  await expect(live).toHaveCount(0);

  // Disconnecting stops the sync.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect X' })).toBeVisible();
});
