import { expect, signIn, test } from '../fixtures';

test('the extension connects, imports, and syncs bookmark changes live', async ({
  extensionContext,
  serviceWorker,
  extensionId,
}) => {
  // Exists before connecting, so it must arrive through the initial import.
  await serviceWorker.evaluate(() =>
    chrome.bookmarks.create({
      parentId: '1',
      title: 'E2E before connect',
      url: 'https://example.org/before',
    }),
  );

  const page = await extensionContext.newPage();
  await signIn(page, 'extension@example.com');

  await page.goto('/extension/connect');
  await page.getByRole('button', { name: 'Connect extension' }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();

  await page.goto('/inbox');
  const link = (name: string) => page.getByRole('link', { name, exact: true });
  await expect(link('E2E before connect')).toBeVisible();
  await expect(page.getByRole('article').filter({ hasText: 'E2E before connect' })).toContainText(
    'Bookmarks bar',
  );

  // Live changes reach the open inbox over server-sent events, without a reload.
  const id = await serviceWorker.evaluate(
    async () =>
      (
        await chrome.bookmarks.create({
          parentId: '1',
          title: 'E2E live',
          url: 'https://example.org/live',
        })
      ).id,
  );
  await expect(link('E2E live')).toBeVisible();

  await serviceWorker.evaluate(
    (bookmarkId) => chrome.bookmarks.update(bookmarkId, { title: 'E2E renamed' }),
    id,
  );
  await expect(link('E2E renamed')).toBeVisible();

  await serviceWorker.evaluate((bookmarkId) => chrome.bookmarks.remove(bookmarkId), id);
  await expect(link('E2E renamed')).toHaveCount(0);
  await expect(link('E2E before connect')).toBeVisible();

  // The popup reflects the connection; disconnecting revokes the extension's key.
  const popup = await extensionContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByText('Connected', { exact: true })).toBeVisible();

  await page.goto('/settings');
  const devices = page.getByRole('listitem').filter({ hasText: 'Chrome extension' });
  await expect(devices).toHaveCount(1);

  await popup.getByRole('button', { name: 'Disconnect this browser' }).click();
  await expect(popup.getByRole('button', { name: 'Connect account' })).toBeVisible();

  await page.reload();
  await expect(page.getByText('No devices connected.')).toBeVisible();
});
