import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test as base,
  type Worker,
} from '@playwright/test';
import { E2E } from './env';

interface ExtensionFixtures {
  /** A Chromium profile with the Bookmark Captain extension installed. */
  extensionContext: BrowserContext;
  /** The extension's background service worker, for driving chrome.bookmarks. */
  serviceWorker: Worker;
  extensionId: string;
}

export const test = base.extend<object, ExtensionFixtures>({
  extensionContext: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring form.
    async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        // The bundled Chromium (not Chrome) supports loading unpacked extensions headlessly.
        channel: 'chromium',
        baseURL: E2E.webUrl,
        args: [
          `--disable-extensions-except=${E2E.extensionDir}`,
          `--load-extension=${E2E.extensionDir}`,
          // No real internet: sites are stand-ins served by `context.route`. A tab the
          // extension opens starts loading before Playwright can intercept it; blocking makes
          // that first load fail, and the extension's reload is then intercepted.
          '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost',
        ],
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  serviceWorker: [
    async ({ extensionContext }, use) => {
      const [existing] = extensionContext.serviceWorkers();
      await use(existing ?? (await extensionContext.waitForEvent('serviceworker')));
    },
    { scope: 'worker' },
  ],
  extensionId: [
    async ({ serviceWorker }, use) => {
      await use(new URL(serviceWorker.url()).host);
    },
    { scope: 'worker' },
  ],
});

export { expect };

/** Signs in through the development login form. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/inbox');
}
