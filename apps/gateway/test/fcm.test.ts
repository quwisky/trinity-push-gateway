import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenExchangeError, type TokenSource } from '../src/auth/google';
import type { FcmMessage } from '../src/payload';
import {
  classifyFcmResponse,
  fcmSendUrl,
  sendFcm,
  type SendResult,
} from '../src/providers/fcm';

function fcmErr(errorCode: string) {
  return {
    error: {
      code: 0,
      message: 'm',
      status: 'X',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.BadRequest' },
        {
          '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
          errorCode,
        },
      ],
    },
  };
}

const message: FcmMessage = {
  token: 'device-token',
  data: { event_id: 'e' },
  android: { priority: 'HIGH' },
  apns: { headers: {}, payload: { aps: {} } },
};

function tokens(...values: string[]): TokenSource & {
  getAccessToken: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
} {
  const getAccessToken = vi.fn();
  for (const v of values) getAccessToken.mockResolvedValueOnce(v);
  return { getAccessToken, invalidate: vi.fn().mockResolvedValue(undefined) };
}

afterEach(() => vi.restoreAllMocks());

describe('fcmSendUrl', () => {
  it('builds the v1 send url', () => {
    expect(fcmSendUrl('p1')).toBe(
      'https://fcm.googleapis.com/v1/projects/p1/messages:send',
    );
  });
});

describe('classifyFcmResponse', () => {
  const cases: [string, number, unknown, SendResult | 'auth'][] = [
    ['200 ok', 200, {}, { outcome: 'ok', status: 200 }],
    [
      '404 UNREGISTERED',
      404,
      fcmErr('UNREGISTERED'),
      { outcome: 'rejected', status: 404, code: 'UNREGISTERED' },
    ],
    [
      '404 NOT_FOUND is failed',
      404,
      { error: { status: 'NOT_FOUND' } },
      { outcome: 'failed', status: 404, code: 'NOT_FOUND' },
    ],
    [
      '403 SENDER_ID_MISMATCH',
      403,
      fcmErr('SENDER_ID_MISMATCH'),
      { outcome: 'rejected', status: 403, code: 'SENDER_ID_MISMATCH' },
    ],
    [
      '403 PERMISSION_DENIED is failed',
      403,
      { error: { status: 'PERMISSION_DENIED' } },
      { outcome: 'failed', status: 403, code: 'PERMISSION_DENIED' },
    ],
    ['401 auth', 401, {}, 'auth'],
    [
      '429 retry',
      429,
      fcmErr('QUOTA_EXCEEDED'),
      { outcome: 'retry', status: 429, code: 'QUOTA_EXCEEDED' },
    ],
    ['500 retry', 500, {}, { outcome: 'retry', status: 500 }],
    [
      '503 html retry',
      503,
      '<html>Service Unavailable</html>',
      { outcome: 'retry', status: 503 },
    ],
    [
      '400 INVALID_ARGUMENT is failed',
      400,
      fcmErr('INVALID_ARGUMENT'),
      { outcome: 'failed', status: 400, code: 'INVALID_ARGUMENT' },
    ],
    ['410 null is failed', 410, null, { outcome: 'failed', status: 410 }],
    [
      '404 UNREGISTERED only in error.status falls back and is rejected',
      404,
      { error: { status: 'UNREGISTERED' } },
      { outcome: 'rejected', status: 404, code: 'UNREGISTERED' },
    ],
  ];

  it.each(cases)('%s', (_name, status, body, expected) => {
    expect(classifyFcmResponse(status, body)).toEqual(expected);
  });

  it('prefers the FcmError detail over error.status', () => {
    const body = fcmErr('UNREGISTERED');
    body.error.status = 'NOT_FOUND';
    expect(classifyFcmResponse(404, body)).toEqual({
      outcome: 'rejected',
      status: 404,
      code: 'UNREGISTERED',
    });
  });
});

describe('sendFcm', () => {
  it('posts one well-formed request', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ name: 'n' }));
    const src = tokens('t1');
    const result = await sendFcm(message, { projectId: 'p1', tokens: src });
    expect(result).toEqual({ outcome: 'ok', status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(fcmSendUrl('p1'));
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer t1');
    expect(headers.get('content-type')).toBe('application/json');
    expect(init?.body).toBe(JSON.stringify({ message }));
  });

  it('invalidates and retries once on 401', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(Response.json({}));
    const src = tokens('t1', 't2');
    const result = await sendFcm(message, { projectId: 'p1', tokens: src });
    expect(result).toEqual({ outcome: 'ok', status: 200 });
    expect(src.invalidate).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchSpy.mock.calls[1]![1]?.headers).get('authorization'),
    ).toBe('Bearer t2');
  });

  it('returns retry when 401 repeats', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('{}', { status: 401 }));
    const src = tokens('t1', 't2');
    const result = await sendFcm(message, { projectId: 'p1', tokens: src });
    expect(result).toEqual({ outcome: 'retry', status: 401 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns retry when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
    const result = await sendFcm(message, {
      projectId: 'p1',
      tokens: tokens('t1'),
    });
    expect(result).toEqual({ outcome: 'retry' });
  });

  it('returns retry when the retry fetch throws after a 401', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockRejectedValueOnce(new TypeError('network'));
    const result = await sendFcm(message, {
      projectId: 'p1',
      tokens: tokens('t1', 't2'),
    });
    expect(result).toEqual({ outcome: 'retry' });
  });

  it('returns retry TOKEN_EXCHANGE without calling FCM', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const src = tokens();
    src.getAccessToken.mockRejectedValue(new TokenExchangeError('boom', 400));
    const result = await sendFcm(message, { projectId: 'p1', tokens: src });
    expect(result).toEqual({
      outcome: 'retry',
      status: 400,
      code: 'TOKEN_EXCHANGE',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps a non-TokenExchangeError token failure to retry TOKEN_EXCHANGE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const src = tokens();
    src.getAccessToken.mockRejectedValue(new Error('kv down'));
    const result = await sendFcm(message, { projectId: 'p1', tokens: src });
    expect(result).toEqual({ outcome: 'retry', code: 'TOKEN_EXCHANGE' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns retry TOKEN_EXCHANGE when the token re-exchange after 401 fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 401 }),
    );
    const src = tokens('t1');
    src.getAccessToken.mockRejectedValueOnce(
      new TokenExchangeError('boom', 503),
    );
    const result = await sendFcm(message, { projectId: 'p1', tokens: src });
    expect(result).toEqual({
      outcome: 'retry',
      status: 503,
      code: 'TOKEN_EXCHANGE',
    });
  });

  it('still retries after 401 when invalidate rejects', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(Response.json({}));
    const src = tokens('t1', 't2');
    src.invalidate.mockRejectedValue(new Error('kv down'));
    const result = await sendFcm(message, { projectId: 'p1', tokens: src });
    expect(result).toEqual({ outcome: 'ok', status: 200 });
  });

  it('classifies a non-JSON 503 body by status without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Service Unavailable</html>', {
        status: 503,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const result = await sendFcm(message, {
      projectId: 'p1',
      tokens: tokens('t1'),
    });
    expect(result).toEqual({ outcome: 'retry', status: 503 });
  });

  it('rejects a dead token end to end', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(fcmErr('UNREGISTERED'), { status: 404 }),
    );
    const result = await sendFcm(message, {
      projectId: 'p1',
      tokens: tokens('t1'),
    });
    expect(result).toEqual({
      outcome: 'rejected',
      status: 404,
      code: 'UNREGISTERED',
    });
  });
});
