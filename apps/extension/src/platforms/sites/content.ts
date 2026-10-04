/**
 * The generic content script for every site the user taught the extension ("Sync this
 * list"). One script, no per-site code: it either learns the saved page and asks the user
 * to confirm, or syncs it with the confirmed recipe.
 */
import type { Platform } from '@bc/shared';
import { sendToBackground } from '../../messages';
import { createOverlay, type OverlayAction } from '../overlay';
import { createRunner, type PlatformRunner } from '../runner';
import { controlTap, listenToTap } from '../tap';
import type { SessionInfo } from '../types';
import { SITE_TAP_TAG } from './constants';
import { type Capture, learnSite } from './learn';
import { collectLinks, inlineJson, pageSettled, sleep } from './page';
import { extractDomPosts, extractJsonPosts, type SiteRecipe } from './recipe';

const MAX_CAPTURES = 80;
/** If the site's data hasn't produced posts by now, read the links on the page instead. */
const DOM_FALLBACK_AFTER_MS = 10_000;

const captures: Capture[] = [];
let onCapture: ((capture: Capture) => void) | null = null;

listenToTap(SITE_TAP_TAG, ({ op, status, json }) => {
  if (status < 200 || status >= 300) return;
  const capture = { source: op, json };
  if (captures.length < MAX_CAPTURES) captures.push(capture);
  onCapture?.(capture);
});

const trimSlash = (path: string) => path.replace(/\/+$/, '') || '/';
const isPath = (url: string) =>
  trimSlash(window.location.pathname) === trimSlash(new URL(url).pathname);

void sendToBackground({ type: 'site:hello' })
  .then((hello) => {
    if (hello.mode === 'learn') {
      void learn(hello.platform, hello.label);
    } else if (hello.mode === 'sync') {
      // Browsing elsewhere on the site: leave it alone. Only the saved list matters.
      if (hello.session.mode === 'passive' && !isPath(hello.listUrl)) {
        controlTap(SITE_TAP_TAG, false);
        return;
      }
      controlTap(SITE_TAP_TAG, true);
      startRunner(
        hello.platform,
        hello.label,
        hello.listUrl,
        hello.recipe,
        Promise.resolve(hello.session),
      );
    } else {
      controlTap(SITE_TAP_TAG, false);
    }
  })
  .catch(() => controlTap(SITE_TAP_TAG, false));

/** Syncs with a recipe: the site's data first, the links on the page as a fallback. */
function startRunner(
  platform: Platform,
  label: string,
  listUrl: string,
  recipe: SiteRecipe,
  session: Promise<SessionInfo>,
): PlatformRunner {
  const runner = createRunner({ platform, label, isListPage: () => isPath(listUrl), session });
  const started = Date.now();
  let fromData = 0;

  const { json, dom } = recipe;
  if (json) {
    const needsLinks = json.fields.link.kind === 'page';
    const feed = (capture: Capture) => {
      const posts = extractJsonPosts(json, capture.json, {
        pageUrl: window.location.href,
        label,
        ...(needsLinks && { links: collectLinks() }),
      });
      if (posts.length === 0) return;
      fromData += posts.length;
      runner.listPage({ posts, hasMore: true });
    };
    onCapture = feed;
    for (const capture of [...captures, ...inlineJson()]) feed(capture);
  }

  if (dom) {
    const seen = new Set<string>();
    const scan = () => {
      if (json && (fromData > 0 || Date.now() - started < DOM_FALLBACK_AFTER_MS)) return;
      const posts = extractDomPosts(dom, {
        pageUrl: window.location.href,
        label,
        links: collectLinks(),
      }).filter((post) => !seen.has(post.externalId));
      for (const post of posts) seen.add(post.externalId);
      if (posts.length > 0) runner.listPage({ posts, hasMore: true });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(scan, 800);
    };
    new MutationObserver(schedule).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    setTimeout(scan, json ? DOM_FALLBACK_AFTER_MS + 500 : 0);
  }
  return runner;
}

/** First visit after "Sync this list": learn the page, show what was found, ask. */
async function learn(platform: Platform, label: string) {
  controlTap(SITE_TAP_TAG, true);
  await pageSettled(2_500);
  const overlay = createOverlay(`Bookmark Captain · ${label}`);
  overlay.show({ message: 'Reading this page to find your saved posts…' });

  // Load a bit more of the list, so there's enough to learn from.
  for (let step = 0; step < 2; step++) {
    window.scrollBy({ top: window.innerHeight * 1.5 });
    await sleep(2_000);
  }
  window.scrollTo({ top: 0 });
  await sleep(400);

  const result = learnSite({
    pageUrl: window.location.href,
    label,
    links: collectLinks(),
    captures: [...captures, ...inlineJson()],
  });

  const close: OverlayAction = { label: 'Close', onClick: () => overlay.remove() };
  const copyDetails: OverlayAction = {
    label: 'Copy details',
    onClick: () => {
      navigator.clipboard.writeText(JSON.stringify(result.report, null, 2)).then(
        () => overlay.update('Copied. The details describe the page’s structure, not your posts.'),
        () => overlay.update('Couldn’t copy the details.'),
      );
    },
  };

  const recipe = result.recipe;
  if (!recipe) {
    void sendToBackground({ type: 'site:reject' });
    overlay.show({
      message: result.report.problem ?? 'Couldn’t learn this page.',
      actions: [copyDetails, close],
    });
    return;
  }

  const confirm = async () => {
    overlay.show({ message: 'Saving…' });
    const session = await sendToBackground({ type: 'site:confirm', recipe });
    if (!('mode' in session) || session.mode === 'passive') {
      overlay.show({
        message: 'error' in session ? session.error : 'Something went wrong. Try again.',
        actions: [close],
      });
      return;
    }
    overlay.remove();
    const runner = startRunner(
      platform,
      label,
      window.location.href,
      recipe,
      Promise.resolve(session),
    );
    runner.listPage({ posts: result.posts, hasMore: true });
  };

  const reject = async () => {
    await sendToBackground({ type: 'site:reject' });
    overlay.show({
      message:
        'Nothing was saved. Open the page that lists your saved posts, scroll so a few are visible, then click Sync this list again.',
      actions: [copyDetails, close],
    });
  };

  const count = result.posts.length;
  overlay.show({
    message: `Found ${count} saved post${count === 1 ? '' : 's'} on this page. Do these look right?`,
    items: result.posts.slice(0, 3).map((post) => post.title ?? post.url),
    actions: [
      { label: 'Looks right', primary: true, onClick: () => void confirm() },
      { label: 'Not right', onClick: () => void reject() },
      copyDetails,
    ],
  });
}
