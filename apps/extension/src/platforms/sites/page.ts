import { parseJsonText } from './json';
import type { Capture } from './learn';
import type { PageLink } from './recipe';

/** What the page shows, read for the learner and for link-based recipes. */

const NAV = 'nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]';
const MAX_LINKS = 1_500;
/** Cards (the text and image around a link) are costly to read: only for this many links. */
const MAX_CARDS = 400;

/** The smallest block around a link that still holds just one post. */
function cardOf(anchor: HTMLAnchorElement): { cardText?: string; image?: string } {
  let card: HTMLElement = anchor;
  for (let depth = 0; depth < 6; depth++) {
    const parent = card.parentElement;
    if (!parent || parent === document.body) break;
    const hrefs = new Set(
      [...parent.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')),
    );
    if (hrefs.size > 3) break;
    card = parent;
  }
  const text = card.innerText.trim().slice(0, 1_000);
  const img = card.querySelector('img');
  const image = img?.currentSrc || img?.src;
  return { ...(text && { cardText: text }), ...(image && { image }) };
}

export function collectLinks(): PageLink[] {
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].slice(0, MAX_LINKS);
  let cards = 0;
  return anchors.map((anchor) => {
    const inNav = anchor.closest(NAV) !== null;
    const withCard = !inNav && cards++ < MAX_CARDS;
    return {
      href: anchor.href,
      text: (anchor.innerText || anchor.getAttribute('aria-label') || '').trim().slice(0, 300),
      inNav,
      ...(withCard && cardOf(anchor)),
    };
  });
}

/** Data some sites embed in the page itself (Next.js, JSON-LD, LinkedIn's <code> blobs). */
export function inlineJson(): Capture[] {
  const nodes = document.querySelectorAll(
    'script[type="application/json"], script[type="application/ld+json"], code[id^="bpr-guid"]',
  );
  const captures: Capture[] = [];
  for (const node of nodes) {
    const text = node.textContent ?? '';
    if (!text || text.length > 5_000_000) continue;
    try {
      captures.push({ source: 'inline', json: parseJsonText(text) });
    } catch {
      // Not JSON: ignore.
    }
  }
  return captures;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves once the page has loaded and had a moment to fetch its first data. */
export async function pageSettled(extraMs: number): Promise<void> {
  if (document.readyState !== 'complete') {
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }
  await sleep(extraMs);
}
