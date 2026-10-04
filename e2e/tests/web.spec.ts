import { expect, signIn, test } from '../fixtures';

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Bookmark Captain' })).toBeVisible();
});

test('save a link, detect a duplicate, and triage it', async ({ page }) => {
  await signIn(page, 'web-triage@example.com');
  const linkInput = page.getByLabel('Link to save');
  const cards = page.getByRole('article');

  await linkInput.fill('example.com/e2e-article?utm_source=newsletter');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(cards).toHaveCount(1);
  // Tracking parameters are stripped from the stored link.
  await expect(cards.getByRole('link')).toHaveAttribute('href', 'https://example.com/e2e-article');

  await linkInput.fill('https://www.example.com/e2e-article/');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('You already saved this link.')).toBeVisible();
  await expect(cards).toHaveCount(1);

  await cards.getByRole('button', { name: /Done/ }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.getByText('Your inbox is clear')).toBeVisible();

  await page.getByRole('tab', { name: 'Done' }).click();
  await expect(cards).toHaveCount(1);
  await cards.getByRole('button', { name: /Back to inbox/ }).click();
  await expect(cards).toHaveCount(0);
  await page.getByRole('tab', { name: 'Inbox' }).click();
  await expect(cards).toHaveCount(1);
});

test('import a bookmarks.html export and search it', async ({ page }) => {
  await signIn(page, 'web-import@example.com');

  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
  <DT><H3>Reading</H3>
  <DL><p>
    <DT><A HREF="https://example.com/rust-guide" ADD_DATE="1700000000">Rust ownership guide</A>
    <DT><A HREF="https://example.com/go-guide" ADD_DATE="1700000100">Go channels guide</A>
    <DT><A HREF="javascript:void(0)">Bookmarklet</A>
  </DL><p>
</DL><p>`;
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bookmarks.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html),
  });

  await expect(page.getByRole('status')).toContainText('2 new');
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('article').first()).toContainText('Reading');

  await page.getByLabel('Search bookmarks').fill('rust');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Rust ownership guide' })).toBeVisible();
});
