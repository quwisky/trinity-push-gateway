import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';

function call(path: string, method = 'GET'): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request('http://gw' + path, { method }),
      env,
      createExecutionContext(),
    ),
  );
}

describe('routes', () => {
  it('GET /health returns ok', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('unknown path returns 404 M_NOT_FOUND', async () => {
    const res = await call('/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ errcode: 'M_NOT_FOUND' });
  });

  it('POST /health returns 405 M_UNRECOGNIZED', async () => {
    const res = await call('/health', 'POST');
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ errcode: 'M_UNRECOGNIZED' });
  });

  it('GET on the notify path returns 405 M_UNRECOGNIZED', async () => {
    const res = await call('/_matrix/push/v1/notify');
    expect(res.status).toBe(405);
    expect(await res.json()).toMatchObject({ errcode: 'M_UNRECOGNIZED' });
  });
});
