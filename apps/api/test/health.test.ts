import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestHarness } from './harness';

const harness = createTestHarness();
const app = harness.createApp();

afterAll(() => harness.close());

describe('health', () => {
  it('reports liveness', async () => {
    const res = await request(app).get('/healthz').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness when the database is reachable', async () => {
    const res = await request(app).get('/readyz').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('echoes a caller-supplied request id', async () => {
    const res = await request(app).get('/healthz').set('x-request-id', 'trace-123');
    expect(res.headers['x-request-id']).toBe('trace-123');
  });

  it('sets security headers', async () => {
    const res = await request(app).get('/healthz');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/does-not-exist').expect(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: 'Route not found' } });
  });
});
