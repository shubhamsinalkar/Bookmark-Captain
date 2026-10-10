import { E2E } from '../env';
import { expect, signIn, test } from '../fixtures';

/**
 * A site the extension has no code for: its own page, its own API and data shape. The test
 * teaches it to the extension the way a user would, from the popup's "Sync this list".
 */
const SITE = E2E.fakeSiteUrl;

const SAVED = [
  {
    id: 'pst8f3k2a',
    title: 'Knife sharpening, properly',
    body: 'A long guide to whetstones, angles and burrs for kitchen knives.',
    author: { username: 'chef_anna', display_name: 'Anna' },
    created_at: 1727000000,
    image: `${SITE}/img/1.jpg`,
  },
  {
    id: 'pst9a7b6c',
    title: 'Sourdough starter in five days',
    body: 'Flour, water and patience: a day-by-day schedule that works.',
    author: { username: 'bakes', display_name: 'Ben Baker' },
    created_at: 1726900000,
    image: `${SITE}/img/2.jpg`,
  },
  {
    id: 'pst1q2w3e',
    title: 'Fixing a dripping tap',
    body: 'Replace the washer, not the whole tap. Ten minutes and two tools.',
    author: { username: 'handy', display_name: 'Hana' },
    created_at: 1726800000,
    image: `${SITE}/img/3.jpg`,
  },
  {
    id: 'pst4r5t6y',
    title: 'Learning Rust ownership',
    body: 'Borrowing explained with drawings instead of compiler errors.',
    author: { username: 'ferris', display_name: 'Ferris' },
    created_at: 1726700000,
    image: `${SITE}/img/4.jpg`,
  },
  {
    id: 'pst7u8i9o',
    title: 'Planting garlic in autumn',
    body: 'Cloves in before the frost, harvest early next summer.',
    author: { username: 'greenthumb', display_name: 'Gita' },
    created_at: 1726600000,
    image: `${SITE}/img/5.jpg`,
  },
];

/** Renders saved posts from its own API, three at a time, loading more on scroll. */
const SAVED_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Saved · savedstuff</title></head><body>
<nav><a href="/">Home</a> <a href="/me">Profile</a></nav>
<main id="list"></main>
<div style="height: 3000px"></div>
<script>
  let page = 0;
  const render = (items) => {
    for (const item of items) {
      const card = document.createElement('article');
      const link = document.createElement('a');
      link.href = '/post/' + item.id + '/';
      link.textContent = item.title;
      const text = document.createElement('p');
      text.textContent = item.body;
      card.append(link, text);
      document.getElementById('list').append(card);
    }
  };
  const load = () =>
    fetch('/api/v2/me/saved?page=' + page)
      .then((response) => response.json())
      .then((data) => { render(data.items); page += 1; });
  load();
  addEventListener('scroll', () => { if (page === 1) load(); });
</script>
</body></html>`;

test('any site: taught from its saved page, confirmed from a preview, then synced', async ({
  extensionContext,
  extensionId,
  serviceWorker,
}) => {
  test.setTimeout(150_000);
  await extensionContext.route(`${SITE}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v2/me/saved') {
      const page = Number(url.searchParams.get('page'));
      const items = page === 0 ? SAVED.slice(0, 3) : page === 1 ? SAVED.slice(3) : [];
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items }) });
    }
    return route.fulfill({ contentType: 'text/html', body: SAVED_PAGE });
  });

  // The extension's browser profile is shared with other tests: start signed out.
  await extensionContext.clearCookies();
  const app = await extensionContext.newPage();
  await signIn(app, 'sites@example.com');
  await app.goto('/extension/connect');
  await app.getByRole('button', { name: /connect extension/i }).click();
  await expect(app.getByText(/^Connected\./)).toBeVisible();

  const site = await extensionContext.newPage();
  await site.goto(`${SITE}/me/saved`);
  await expect(site.getByRole('link', { name: 'Knife sharpening, properly' })).toBeVisible();
  const tabId = await serviceWorker.evaluate(
    async (origin) => (await chrome.tabs.query({ url: `${origin}/*` }))[0]?.id,
    SITE,
  );

  // The popup, opened over the saved page: "Sync this list".
  const popup = await extensionContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await popup.getByRole('button', { name: 'Sync this list' }).click();

  // The page reloads, the extension learns it and asks.
  await expect(
    site.getByText('Found 5 saved posts on this page. Do these look right?'),
  ).toBeVisible({
    timeout: 45_000,
  });
  await expect(site.getByText('Knife sharpening, properly').last()).toBeVisible();
  await site.getByRole('button', { name: 'Looks right' }).click();

  await app.goto('/inbox?source=savedstuff.test');
  await expect(app.getByRole('article')).toHaveCount(5);
  const knife = app.getByRole('article').filter({ hasText: 'Knife sharpening, properly' });
  await expect(knife).toContainText('Anna (@chef_anna)');
  await expect(knife.getByRole('link')).toHaveAttribute('href', `${SITE}/post/pst8f3k2a/`);

  // The site now appears with the other platforms, and can be disconnected.
  await app.goto('/settings');
  await expect(app.getByText('learned from your saved page')).toBeVisible();
  await expect(app.getByText('5 posts synced')).toBeVisible();
  await app.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(app.getByText('learned from your saved page')).toHaveCount(0);
});
