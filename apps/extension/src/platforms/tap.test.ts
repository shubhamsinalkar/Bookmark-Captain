import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNetworkTap, type TapMessage } from './tap';

/** A stand-in page: `fetch` answers with `answer`, and posted messages are collected. */
function page(answer: () => Response) {
  const posted: TapMessage[] = [];
  vi.stubGlobal('window', {
    location: { origin: 'https://site.test', href: 'https://site.test/' },
    fetch: () => Promise.resolve(answer()),
    postMessage: (message: TapMessage) => posted.push(message),
    addEventListener: () => undefined,
  });
  vi.stubGlobal('XMLHttpRequest', class {});
  installNetworkTap('test', (url) => (url.includes('/graphql') ? 'graphql' : null));
  return posted;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installNetworkTap', () => {
  it('passes on JSON answers with their request', async () => {
    const posted = page(() => Response.json({ ok: true }));
    await window.fetch('/graphql', { method: 'POST', body: 'a=1' });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted).toEqual([
      expect.objectContaining({
        op: 'graphql',
        status: 200,
        requestBody: 'a=1',
        json: { ok: true },
      }),
    ]);
  });

  it('passes on a mutation whose JSON answer is labelled otherwise', async () => {
    // Instagram answers its GraphQL mutations with JSON labelled text/html.
    const posted = page(
      () =>
        new Response('{"data":{}}', { headers: { 'content-type': 'text/html; charset="utf-8"' } }),
    );
    await window.fetch('/graphql', { method: 'POST', body: 'fb_api_req_friendly_name=Save' });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted).toEqual([
      expect.objectContaining({
        op: 'graphql',
        requestBody: 'fb_api_req_friendly_name=Save',
        json: { data: {} },
      }),
    ]);
  });

  it('passes on a mutation whose answer is not JSON at all, without the answer', async () => {
    const posted = page(
      () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    );
    await window.fetch('/graphql', { method: 'POST', body: 'a=1' });
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted).toEqual([expect.objectContaining({ requestBody: 'a=1', json: null })]);
  });

  it('ignores unlabelled answers to requests without a body, and other addresses', async () => {
    const posted = page(
      () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    );
    await window.fetch('/graphql');
    await window.fetch('/elsewhere', { method: 'POST', body: 'a=1' });
    await settled();
    expect(posted).toEqual([]);
  });
});
