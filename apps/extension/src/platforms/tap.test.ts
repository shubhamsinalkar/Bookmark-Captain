import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNetworkTap, type TapMessage } from './tap';

/** What the page's own `fetch` was called with, after the tap. */
let sent: Parameters<typeof fetch>[] = [];

/** A stand-in page: `fetch` answers with `answer`, and posted messages are collected. */
function page(answer: () => Response) {
  const posted: TapMessage[] = [];
  sent = [];
  vi.stubGlobal('window', {
    location: { origin: 'https://site.test', href: 'https://site.test/' },
    fetch: (...args: Parameters<typeof fetch>) => {
      sent.push(args);
      return Promise.resolve(answer());
    },
    postMessage: (message: TapMessage) => posted.push(message),
    addEventListener: () => undefined,
  });
  vi.stubGlobal('XMLHttpRequest', class {});
  installNetworkTap('test', (url) => (url.includes('/graphql') ? 'graphql' : null));
  return posted;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Gzipped like YouTube's requests (`wug_networking_gzip_request`). */
const gzip = async (text: string) =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer(),
  );

const EDIT = JSON.stringify({
  context: { client: { clientName: 'WEB' } },
  actions: [{ addedVideoId: 'aaaaaaaaaa1', action: 'ACTION_ADD_VIDEO' }],
  playlistId: 'WL',
});

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

  it('reads gzipped request bodies, however they are passed', async () => {
    const posted = page(() => Response.json({ status: 'STATUS_SUCCEEDED' }));
    const bytes = await gzip(EDIT);
    await window.fetch('/graphql', { method: 'POST', body: bytes });
    await window.fetch(new Request('https://site.test/graphql', { method: 'POST', body: bytes }));
    await vi.waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((message) => message.requestBody)).toEqual([EDIT, EDIT]);
  });

  it('reads a streamed body from a copy, leaving the page its own', async () => {
    const posted = page(() => Response.json({ ok: true }));
    const stream = new Blob([await gzip(EDIT)]).stream();
    await window.fetch('/graphql', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await vi.waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.requestBody).toBe(EDIT);
    const pageBody = sent[0]![1]!.body as ReadableStream<Uint8Array>;
    expect(await new Response(pageBody).arrayBuffer()).toEqual((await gzip(EDIT)).buffer);
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
