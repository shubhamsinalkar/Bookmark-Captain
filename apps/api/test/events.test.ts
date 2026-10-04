import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import { createApiToken, createTestHarness } from './harness';

const harness = createTestHarness();
let server: Server;
let ctx: AppContext;
let baseUrl: string;

beforeEach(async () => {
  await harness.reset();
  const created = harness.createAppWithContext();
  ctx = created.ctx;
  server = created.app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  ctx.events.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
afterAll(() => harness.close());

/** Opens an SSE stream and returns a function that waits for the next event of a type. */
async function openStream(token: string) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  async function next(type: string): Promise<unknown> {
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        if (frame.includes(`event: ${type}`) && data) return JSON.parse(data);
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('Stream closed');
      buffer += value;
    }
  }

  return { response, next, reader, close: () => controller.abort() };
}

describe('GET /events', () => {
  it('requires authentication', async () => {
    const res = await fetch(`${baseUrl}/events`);
    expect(res.status).toBe(401);
  });

  it('streams a change event when bookmarks are ingested', async () => {
    const { token } = await createApiToken(server);
    const stream = await openStream(token);
    expect(stream.response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    await expect(stream.next('ready')).resolves.toEqual({ type: 'ready' });

    await request(server)
      .post('/bookmarks/ingest')
      .auth(token, { type: 'bearer' })
      .send({ items: [{ platform: 'browser', url: 'https://example.com' }] })
      .expect(200);

    await expect(stream.next('bookmarks.changed')).resolves.toEqual({
      type: 'bookmarks.changed',
      reason: 'ingest',
    });
    stream.close();
  });

  it("does not receive other users' events", async () => {
    const { token: aliceToken } = await createApiToken(server, 'alice@example.com');
    const { token: bobToken } = await createApiToken(server, 'bob@example.com');
    const created = await request(server)
      .post('/bookmarks')
      .auth(aliceToken, { type: 'bearer' })
      .send({ url: 'https://example.org' })
      .expect(201);

    const alice = await openStream(aliceToken);
    await alice.next('ready');

    // Bob ingests (reason "ingest"), then Alice deletes (reason "delete").
    await request(server)
      .post('/bookmarks/ingest')
      .auth(bobToken, { type: 'bearer' })
      .send({ items: [{ platform: 'browser', url: 'https://example.com' }] })
      .expect(200);
    await request(server)
      .delete(`/bookmarks/${created.body.bookmark.id}`)
      .auth(aliceToken, { type: 'bearer' })
      .expect(204);

    // If Bob's event had leaked, Alice's first change event would be "ingest".
    await expect(alice.next('bookmarks.changed')).resolves.toEqual({
      type: 'bookmarks.changed',
      reason: 'delete',
    });
    alice.close();
  });

  it('is closed by the server on shutdown', async () => {
    const { token } = await createApiToken(server);
    const stream = await openStream(token);
    await stream.next('ready');

    ctx.events.closeAllConnections();
    await expect(stream.next('never')).rejects.toThrow('Stream closed');
  });
});
