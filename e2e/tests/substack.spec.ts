import { connectExtension, expect, signIn, test } from '../fixtures';

/**
 * A stand-in for substack.com and a newsletter's own site, served by Playwright: Substack's
 * saved lists (`/api/v1/reader/saved?filter=posts|notes`, a page at a time), and pages whose
 * Save buttons send the requests Substack's web app sends, so the real extension runs against
 * it without touching the network or a Substack account.
 */
const post = (id: number, title: string, savedAt: string) => ({
  entity_key: `p-${id}`,
  type: 'post',
  context: { type: 'post', timestamp: savedAt },
  publication: {
    name: 'Better Engineers',
    base_url: 'https://betterengineers.substack.com',
  },
  post: {
    id,
    title,
    subtitle: 'An engineering story',
    canonical_url: `https://betterengineers.substack.com/p/post-${id}`,
    post_date: '2026-11-01T10:00:00.000Z',
    type: 'newsletter',
    publishedBylines: [{ name: 'Better Engineering' }],
  },
});

const POSTS_FIRST = [
  post(101, 'How Slack Scaled MySQL', '2026-11-10T10:00:00.000Z'),
  post(102, 'How to Become a Good Backend Engineer', '2026-11-09T10:00:00.000Z'),
];
const POSTS_LAST = [post(103, 'How To Talk To Anyone', '2026-11-08T10:00:00.000Z')];
const NOTE = {
  entity_key: 'c-501',
  type: 'comment',
  context: { type: 'note', timestamp: '2026-11-11T10:00:00.000Z' },
  comment: {
    id: 501,
    name: 'E2E Writer',
    handle: 'e2e_writer',
    body: 'Scale From Zero to Millions of Users\n\nYour app runs on one server.',
    date: '2026-11-10T03:00:00.000Z',
    attachments: [],
  },
};
const LIVE = post(901, 'Ship small changes, often', '2026-11-12T10:00:00.000Z');
const NEWSLETTER = post(902, 'Saved on the newsletter site', '2026-11-12T11:00:00.000Z');

const savePage = (postId: number) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Substack</title></head><body>
<button id="save">Save</button>
<button id="unsave">Unsave</button>
<script>
  const send = (method) =>
    fetch('/api/v1/posts/saved', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ post_id: ${postId} }),
    });
  document.getElementById('save').onclick = () => send('POST');
  document.getElementById('unsave').onclick = () => send('DELETE');
</script>
</body></html>`;

test('Substack: connecting imports saved posts and notes, then saves sync live', async ({
  extensionContext,
}) => {
  test.setTimeout(150_000);
  const saved = new Set<number>();

  await extensionContext.route('https://substack.com/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', json: body });
    if (url.pathname === '/api/v1/reader/saved') {
      const filter = url.searchParams.get('filter');
      // Like the real one: a saved link would break `all` and `links`.
      if (filter === 'notes') return json({ items: [NOTE], nextCursor: null });
      if (filter !== 'posts') return route.fulfill({ status: 500, json: { error: '' } });
      const extra = [LIVE, NEWSLETTER].filter((item) => saved.has(item.post.id));
      return json(
        url.searchParams.get('cursor') === 'page-2'
          ? { items: POSTS_LAST, nextCursor: null }
          : { items: [...extra, ...POSTS_FIRST], nextCursor: 'page-2' },
      );
    }
    if (url.pathname === '/api/v1/posts/saved') {
      if (request.method() === 'POST') saved.add(LIVE.post.id);
      else saved.delete(LIVE.post.id);
      return json({});
    }
    return route.fulfill({ contentType: 'text/html', body: savePage(LIVE.post.id) });
  });
  await extensionContext.route('https://betterengineers.substack.com/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/v1/posts/saved') {
      saved.add(NEWSLETTER.post.id);
      return route.fulfill({ contentType: 'application/json', json: {} });
    }
    return route.fulfill({ contentType: 'text/html', body: savePage(NEWSLETTER.post.id) });
  });

  // The extension's browser profile is shared with other tests: start signed out.
  await extensionContext.clearCookies();
  const page = await extensionContext.newPage();
  await signIn(page, 'substack-connector@example.com');
  await connectExtension(page);

  // Connect Substack from Settings: the extension opens your Saved page and reads both lists.
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Connect Substack' }).click();
  await expect(page.getByText('4 posts synced')).toBeVisible({ timeout: 45_000 });

  await page.goto('/inbox?source=substack');
  await expect(page.getByRole('article')).toHaveCount(4);
  const slack = page.getByRole('article').filter({ hasText: 'How Slack Scaled MySQL' });
  await expect(slack).toContainText('Better Engineering');
  await expect(slack.getByRole('link')).toHaveAttribute(
    'href',
    'https://betterengineers.substack.com/p/post-101',
  );
  await expect(
    page.getByRole('link', { name: 'Scale From Zero to Millions of Users' }),
  ).toHaveAttribute('href', 'https://substack.com/@e2e_writer/note/c-501');

  // Saving a post on substack.com sends it straight away…
  const substack = await extensionContext.newPage();
  await substack.goto('https://substack.com/home');
  await substack.getByRole('button', { name: 'Save', exact: true }).click();
  const live = page.getByRole('link', { name: 'Ship small changes, often' });
  await expect(live).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(5);

  // …and unsaving it removes it here.
  await substack.getByRole('button', { name: 'Unsave' }).click();
  await expect(live).toHaveCount(0);

  // On a newsletter's own site the list is read again in the background, a little later.
  const newsletter = await extensionContext.newPage();
  await newsletter.goto('https://betterengineers.substack.com/p/post-902');
  await newsletter.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Saved on the newsletter site' })).toBeVisible({
    timeout: 75_000,
  });

  // Disconnecting stops the sync.
  await page.goto('/settings');
  await page.locator('#platforms').getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Substack' })).toBeVisible();
});
