import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  request,
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

/**
 * Connects the extension to the signed-in account. The browser profile is shared between
 * tests, so the extension may still hold an earlier test's key: the page then offers
 * "Reconnect the extension" instead of "Connect extension", which does the same.
 */
export async function connectExtension(page: Page): Promise<void> {
  await page.goto('/extension/connect');
  await page.getByRole('button', { name: /^(re)?connect (the )?extension$/i }).click();
  await expect(page.getByText(/^Connected\./)).toBeVisible();
}

export const E2E_PASSWORD = 'e2e password 123';

/**
 * Signs in through the email + password form. The account is created over the API first,
 * from a separate request context so the browser's cookies are left alone (a 409 means it
 * already exists, so the same email can sign in again in a later test).
 */
export async function signIn(page: Page, email: string): Promise<void> {
  const api = await request.newContext({ extraHTTPHeaders: { origin: E2E.webUrl } });
  const signup = await api.post(new URL('/auth/signup', E2E.apiUrl).toString(), {
    data: { email, password: E2E_PASSWORD },
  });
  const status = signup.status();
  const body = await signup.text();
  await api.dispose();
  if (status !== 201 && status !== 409) throw new Error(`Sign-up failed: ${status} ${body}`);

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/inbox');
}
