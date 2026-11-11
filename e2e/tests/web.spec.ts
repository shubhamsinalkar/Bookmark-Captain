import { E2E } from '../env';
import { expect, signIn, test } from '../fixtures';

test('signed-out visitors are sent to the login page', async ({ page }) => {
  await page.goto('/inbox');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Bookmark Captain' })).toBeVisible();
});

test('save a link, detect a duplicate, and triage it', async ({ page }) => {
  await signIn(page, 'web-triage@example.com');
  // One box searches and saves: a pasted link offers Save link.
  const box = page.getByLabel('Search or paste a link');
  const cards = page.getByRole('article');
  const views = page.getByRole('navigation', { name: 'Views' });

  await box.fill('example.com/e2e-article?utm_source=newsletter');
  await page.getByRole('button', { name: 'Save link' }).click();
  await expect(cards).toHaveCount(1);
  // Tracking parameters are stripped from the stored link.
  await expect(cards.getByRole('link')).toHaveAttribute('href', 'https://example.com/e2e-article');

  await box.fill('https://www.example.com/e2e-article/');
  await page.getByRole('button', { name: 'Save link' }).click();
  await expect(page.getByText('You already saved this link.')).toBeVisible();
  await expect(cards).toHaveCount(1);

  await cards.getByRole('button', { name: /Done/ }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.getByText('Your inbox is clear')).toBeVisible();

  await views.getByRole('link', { name: /^Done/ }).click();
  await expect(cards).toHaveCount(1);
  await cards.getByRole('button', { name: /Back to inbox/ }).click();
  await expect(cards).toHaveCount(0);
  await views.getByRole('link', { name: /^Inbox/ }).click();
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

  await page.getByLabel('Search or paste a link').fill('rust');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Rust ownership guide' })).toBeVisible();
});

test('create an account with email and password, then sign in again', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Create an account' }).click();
  await expect(page).toHaveURL(/\/login\?mode=signup$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

  // Mistakes are shown next to the field they belong to, before anything is sent.
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  await expect(page.getByText('Use at least 8 characters')).toBeVisible();

  await page.getByLabel('Name').fill('Web Signup');
  await page.getByLabel('Email').fill('Web-Signup@Example.com');
  await page.getByLabel('Password', { exact: true }).fill('a long password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/inbox');

  // Signed out, the same email can't be registered twice...
  await page.context().clearCookies();
  await page.goto('/login?mode=signup');
  await page.getByLabel('Email').fill('web-signup@example.com');
  await page.getByLabel('Password', { exact: true }).fill('another password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('An account with this email already exists')).toBeVisible();

  // ...a wrong password is refused...
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email').fill('web-signup@example.com');
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Incorrect email or password')).toBeVisible();

  // ...and the right one gets back in.
  await page.getByLabel('Password', { exact: true }).fill('a long password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/inbox');
});

test('an account without a password adds one in Settings, then changes it', async ({ page }) => {
  // Stand-in for an account made with Google: it exists but has no password.
  await page.request.post(new URL('/auth/dev-login', E2E.apiUrl).toString(), {
    data: { email: 'google-only@example.com' },
    headers: { origin: E2E.webUrl },
  });

  await page.goto('/settings');
  const section = page.locator('#password');
  await expect(section.getByText('Your account has no password yet')).toBeVisible();
  await section.getByLabel('Password', { exact: true }).fill('short');
  await section.getByRole('button', { name: 'Set password' }).click();
  await expect(section.getByText('Use at least 8 characters')).toBeVisible();

  await section.getByLabel('Password', { exact: true }).fill('first password');
  await section.getByRole('button', { name: 'Set password' }).click();
  await expect(section.getByText('Password set.')).toBeVisible();
  // The section now offers a change instead.
  await expect(section.getByRole('button', { name: 'Change password' })).toBeVisible();

  // A wrong current password is refused without signing us out...
  await section.getByLabel('Current password').fill('not it');
  await section.getByLabel('New password').fill('second password');
  await section.getByRole('button', { name: 'Change password' }).click();
  await expect(section.getByText('Current password is incorrect')).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);

  // ...the right one works.
  await section.getByLabel('Current password').fill('first password');
  await section.getByLabel('New password').fill('second password');
  await section.getByRole('button', { name: 'Change password' }).click();
  await expect(section.getByText('Password changed.')).toBeVisible();

  // Signed out, the new password signs in.
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill('google-only@example.com');
  await page.getByLabel('Password', { exact: true }).fill('second password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/inbox');
});
