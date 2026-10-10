import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOKEN_URL } from '../src/auth/google';
import app, { NOTIFY_PATH } from '../src/index';
import { MAX_BODY_BYTES } from '../src/notify/parse';
import { fcmSendUrl } from '../src/providers/fcm';

const FCM_URL = fcmSendUrl('trinity-test');
const ACCESS_TOKEN = 'ya29.test-access-token';
const APP_ID = 'dev.trinityproject.trinity.android';

function fcmError(status: number, errorCode: string): Response {
  return Response.json(
    {
      error: {
        code: status,
        message: 'm',
        status: 'X',
        details: [
          {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode,
          },
        ],
      },
    },
    { status },
  );
}

const ok = () => Response.json({ name: 'projects/trinity-test/messages/1' });

type FcmHandler = (init: RequestInit | undefined) => Response;
let fcm: FcmHandler;
let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

beforeEach(() => {
  // Keep delivery log lines out of the test output.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  fcm = ok;
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === TOKEN_URL) {
      return Promise.resolve(
        Response.json({ access_token: ACCESS_TOKEN, expires_in: 3600 }),
      );
    }
    if (url === FCM_URL) return Promise.resolve(fcm(init));
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
});

afterEach(() => vi.restoreAllMocks());

const fcmCalls = () => fetchSpy.mock.calls.filter(([url]) => url === FCM_URL);
const sentBody = (call: number): { message: Record<string, unknown> } =>
  JSON.parse(String(fcmCalls()[call]?.[1]?.body));

function device(pushkey: string, extra: Record<string, unknown> = {}) {
  return {
    app_id: APP_ID,
    pushkey,
    data: { trinity_user_id: '@u:x' },
    ...extra,
  };
}

function body(
  devices: unknown[] = [device('pk1')],
  notification: Record<string, unknown> = {
    event_id: '$e',
    room_id: '!r:x',
    prio: 'high',
    counts: { unread: 2 },
  },
): string {
  return JSON.stringify({ notification: { ...notification, devices } });
}

function post(payload: string, bindings: object = env): Promise<Response> {
  return Promise.resolve(
    app.fetch(
      new Request('http://gw' + NOTIFY_PATH, { method: 'POST', body: payload }),
      bindings as Env,
      createExecutionContext(),
    ),
  );
}

function postStream(stream: ReadableStream<Uint8Array>): Promise<Response> {
  const req = new Request('http://gw' + NOTIFY_PATH, {
    method: 'POST',
    body: stream,
    duplex: 'half',
  } as RequestInit);
  // A stream body is sent chunked: there is no length to trust up front.
  expect(req.headers.get('content-length')).toBeNull();
  return Promise.resolve(app.fetch(req, env, createExecutionContext()));
}

function chunked(
  text: string,
  chunkSize: number,
  hooks: { pulled?: () => void; cancelled?: () => void } = {},
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      hooks.pulled?.();
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
    cancel() {
      hooks.cancelled?.();
    },
  });
}

describe('POST notify', () => {
  it('delivers', async () => {
    const res = await post(body());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: [] });
    const { message } = sentBody(0);
    expect(message.token).toBe('pk1');
    expect(message.data).toMatchObject({ trinity_user_id: '@u:x' });
  });

  it('rejects a dead token', async () => {
    fcm = () => fcmError(404, 'UNREGISTERED');
    const res = await post(body([device('pk-dead')]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: ['pk-dead'] });
  });

  it('rejects an unknown app id without calling FCM', async () => {
    const res = await post(
      body([device('pk-unknown', { app_id: 'other.app' })]),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: ['pk-unknown'] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 502 on an upstream failure', async () => {
    fcm = () => fcmError(503, 'UNAVAILABLE');
    const res = await post(body([device('pk-503')]));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ errcode: 'M_UNKNOWN' });
  });

  it('lets a retry win over a success', async () => {
    fcm = (init) =>
      String(init?.body).includes('"pk-retry"')
        ? fcmError(503, 'UNAVAILABLE')
        : ok();
    const res = await post(body([device('pk-fine'), device('pk-retry')]));
    expect(res.status).toBe(502);
  });

  it('does not reject on a permanent failure', async () => {
    fcm = () => fcmError(400, 'INVALID_ARGUMENT');
    const res = await post(body([device('pk-400')]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: [] });
  });

  it('dedupes rejected pushkeys', async () => {
    fcm = () => fcmError(404, 'UNREGISTERED');
    const res = await post(body([device('pk-dup'), device('pk-dup')]));
    expect(await res.json()).toEqual({ rejected: ['pk-dup'] });
  });

  it('accepts a request with no devices', async () => {
    const res = await post(body([]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips an event-less notification without unread', async () => {
    const res = await post(body([device('pk-skip')], { room_id: '!r:x' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: [] });
    expect(fcmCalls()).toHaveLength(0);
  });

  it('skips a throttled device', async () => {
    const throttled = {
      ...env,
      PUSHKEY_LIMITER: { limit: async () => ({ success: false }) },
    };
    const res = await post(body([device('pk-throttled')]), throttled);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: [] });
    expect(fcmCalls()).toHaveLength(0);
  });

  it('answers 400 M_BAD_JSON for invalid JSON', async () => {
    const res = await post('{nope');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errcode: 'M_BAD_JSON' });
  });

  it('answers 400 for more than 10 devices', async () => {
    const devices = Array.from({ length: 11 }, (_, i) => device(`pk-many${i}`));
    const res = await post(body(devices));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errcode: 'M_BAD_JSON' });
  });

  it('answers 413 M_TOO_LARGE for an oversized body', async () => {
    const res = await post('x'.repeat(MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ errcode: 'M_TOO_LARGE' });
  });

  it('answers 413 M_TOO_LARGE for an oversized streamed body, cancelling early', async () => {
    const chunkSize = 1024;
    const totalChunks = 1000;
    let pulled = 0;
    let cancelled = false;
    const res = await postStream(
      chunked('x'.repeat(chunkSize * totalChunks), chunkSize, {
        pulled: () => pulled++,
        cancelled: () => (cancelled = true),
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ errcode: 'M_TOO_LARGE' });
    expect(cancelled).toBe(true);
    // The limit is 64 chunks; allow a little read-ahead, but not the whole body.
    expect(pulled).toBeLessThan(totalChunks / 2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 413 for a streamed body one byte over the limit', async () => {
    const res = await postStream(
      chunked('x'.repeat(MAX_BODY_BYTES + 1), MAX_BODY_BYTES),
    );
    expect(res.status).toBe(413);
  });

  it('delivers a streamed body under the limit, with multibyte text split across chunks', async () => {
    const payload = body([device('pk-stream')], {
      event_id: '$e',
      room_id: '!r:x',
      prio: 'high',
      counts: { unread: 2 },
      content: { body: 'héllo wörld ✓ 🎉' },
    });
    const res = await postStream(chunked(payload, 7));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rejected: [] });
    expect(sentBody(0).message.token).toBe('pk-stream');
  });

  it('answers 400 for a request without a body', async () => {
    const res = await Promise.resolve(
      app.fetch(
        new Request('http://gw' + NOTIFY_PATH, { method: 'POST' }),
        env,
        createExecutionContext(),
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errcode: 'M_BAD_JSON' });
  });

  it('answers 500 M_UNKNOWN for a broken config without calling out', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(body([device('pk-cfg')]), {
      ...env,
      FCM_SERVICE_ACCOUNT: 'nope',
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ errcode: 'M_UNKNOWN' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('logs no identifiers', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spies = [
      logSpy,
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
    await post(body([device('pk1')]));
    fcm = () => fcmError(404, 'UNREGISTERED');
    await post(body([device('pk-log-dead')]));

    const logged = spies
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map((a) => JSON.stringify(a)).join(' '))
      .join('\n');
    for (const secret of [
      'pk-log',
      'pk1',
      '@u:x',
      '!r:x',
      '$e',
      ACCESS_TOKEN,
    ]) {
      expect(logged).not.toContain(secret);
    }
    const deliveries = logSpy.mock.calls
      .map(([line]) => JSON.parse(String(line)))
      .filter((l) => l.event === 'delivery');
    expect(deliveries).toContainEqual(
      expect.objectContaining({ appId: APP_ID, outcome: 'ok' }),
    );
  });
});
