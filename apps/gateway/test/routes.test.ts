import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import app, { NOTIFY_PATH } from '../src/index';

async function call(path: string, method = 'GET'): Promise<Response> {
  return app.fetch(
    new Request('http://gw' + path, { method }),
    env,
    createExecutionContext(),
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

  it('turns an unexpected error into a fixed 500 M_UNKNOWN and logs no request data', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const brokenEnv = {
      get APPS(): never {
        throw new TypeError('secret-pushkey-value');
      },
    } as unknown as Env;
    const res = await app.fetch(
      new Request('http://gw' + NOTIFY_PATH, {
        method: 'POST',
        body: JSON.stringify({
          notification: { devices: [{ app_id: 'a', pushkey: 'pk' }] },
        }),
      }),
      brokenEnv,
      createExecutionContext(),
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      errcode: 'M_UNKNOWN',
      error: 'Internal error',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-pushkey');
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
