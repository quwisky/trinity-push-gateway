import { createExecutionContext, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

import { version as gatewayVersion } from '../../../package.json';
import type { FcmDelivery } from '../src/fcm';
import type { Env } from '../src/cloudflare-env';
import worker, { createGateway } from '../src/index';

const NOTIFY_URL = 'https://gateway.test/_matrix/push/v1/notify';

type ValidClientInstallation = Readonly<{
  app_id: string;
  data: Readonly<{
    format: string;
    trinity_account_id: string;
    trinity_push_version: string;
  }>;
  pushkey: string;
}>;

function notifyRequest(body: unknown): Request {
  return new Request(NOTIFY_URL, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

function validClientInstallation(): ValidClientInstallation {
  return {
    app_id: 'ovh.qwky.trinity.android',
    data: {
      format: 'event_id_only',
      trinity_account_id: 'account-route',
      trinity_push_version: '1',
    },
    pushkey: 'fcm-push-key',
  };
}

function recordingGateway(): {
  readonly deliveries: FcmDelivery[];
  readonly gateway: ReturnType<typeof createGateway>;
} {
  const deliveries: FcmDelivery[] = [];
  const gateway = createGateway({
    fcmClient: {
      async send(delivery: FcmDelivery) {
        deliveries.push(delivery);
        return { kind: 'delivered' as const };
      },
    },
    now: () => 2_000_000_000_000,
  });

  return { deliveries, gateway };
}

describe('gateway HTTP boundary', () => {
  beforeEach(async () => {
    await env.TRINITY_PUSH_GATEWAY_DB.batch([
      env.TRINITY_PUSH_GATEWAY_DB.prepare('DELETE FROM delivery_records'),
      env.TRINITY_PUSH_GATEWAY_DB.prepare('DELETE FROM daily_budgets'),
    ]);
  });

  it('records fixed outcomes only for actual FCM calls and not terminal dedup reads', async () => {
    let now = 2_000_000_000_000;
    const requests: string[] = [];
    const attempts: (readonly [string, string, number])[] = [];
    const gateway = createGateway({
      fcmClient: {
        async send() {
          now += 249;
          return { kind: 'delivered' as const };
        },
      },
      metrics: {
        recordFcmAttempt(platform, outcome, latencyMs) {
          attempts.push([platform, outcome, latencyMs]);
        },
        recordRequest(outcome) {
          requests.push(outcome);
        },
      },
      now: () => now,
    });
    const request = (): Request =>
      notifyRequest({
        notification: {
          devices: [validClientInstallation()],
          event_id: '$metrics-event:example.test',
          room_id: '!metrics-room:example.test',
        },
      });

    expect(
      (await gateway.fetch(request(), env, createExecutionContext())).status,
    ).toBe(200);
    expect(
      (await gateway.fetch(request(), env, createExecutionContext())).status,
    ).toBe(200);
    expect(requests).toEqual(['processed', 'processed']);
    expect(attempts).toEqual([['android', 'accepted', 249]]);
  });

  it('reports its version and readiness without contacting FCM', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/health'),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    );
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      version: gatewayVersion,
    });
  });

  it('reports not ready when required secrets are absent', async () => {
    const unconfiguredEnv = {
      ...env,
      TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY: '',
      TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY: '',
    } satisfies Env;

    const response = await worker.fetch(
      new Request('https://gateway.test/health'),
      unconfiguredEnv,
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'error',
      version: gatewayVersion,
    });
  });

  it('reports not ready when a numeric limit is malformed', async () => {
    const invalidEnv = {
      ...env,
      TRINITY_PUSH_GATEWAY_MAX_DEVICES: 'unlimited',
    } satisfies Env;

    const response = await worker.fetch(
      new Request('https://gateway.test/health'),
      invalidEnv,
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'error',
      version: gatewayVersion,
    });
  });

  it('normalizes invalid configuration for the Matrix POST boundary', async () => {
    const response = await worker.fetch(
      notifyRequest({ notification: { devices: [] } }),
      {
        ...env,
        TRINITY_PUSH_GATEWAY_MAX_DEVICES: '50',
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      errcode: 'M_UNKNOWN',
      error: 'Gateway is not configured.',
    });
  });

  it('uses the Matrix unrecognized error for an unsupported method', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify'),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      errcode: 'M_UNRECOGNIZED',
      error: 'Method not allowed.',
    });
  });

  it('rejects a body that is not JSON', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: '{',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      errcode: 'M_NOT_JSON',
      error: 'Request body must be valid JSON.',
    });
  });

  it('rejects JSON that is not a Matrix notification request', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      errcode: 'M_BAD_JSON',
      error: 'Invalid Matrix notification request.',
    });
  });

  it.each([
    ['missing devices', {}],
    ['non-array devices', { devices: {} }],
    ['null counts', { counts: null, devices: [] }],
    ['negative unread count', { counts: { unread: -1 }, devices: [] }],
    [
      'fractional missed-call count',
      { counts: { missed_calls: 0.5 }, devices: [] },
    ],
    [
      'unsafe unread count',
      { counts: { unread: 9_007_199_254_740_992 }, devices: [] },
    ],
    ['unsupported priority', { devices: [], prio: 'urgent' }],
    ['event without a room', { devices: [], event_id: '$event:example.test' }],
    ['non-string room', { devices: [], room_id: 42 }],
  ] satisfies readonly [string, unknown][])(
    'uses the generic Matrix error for %s',
    async (_description, notification) => {
      const response = await worker.fetch(
        notifyRequest({ notification }),
        env,
        createExecutionContext(),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        errcode: 'M_BAD_JSON',
        error: 'Invalid Matrix notification request.',
      });
    },
  );

  it('preserves loose fields, schema bounds, and notification defaults', async () => {
    const { deliveries, gateway } = recordingGateway();
    const accountRoute = `A_-${'a'.repeat(45)}`;
    const pushKey = '😀'.repeat(2048);
    const response = await gateway.fetch(
      notifyRequest({
        future_root_field: true,
        notification: {
          counts: { future_count_field: true },
          devices: [
            {
              app_id: 'ovh.qwky.trinity.android',
              data: {
                format: 'event_id_only',
                future_data_field: true,
                trinity_account_id: accountRoute,
                trinity_push_version: '1',
              },
              future_client_installation_field: true,
              pushkey: pushKey,
              tweaks: 7,
            },
          ],
          event_id: '$event:example.test',
          future_notification_field: true,
          room_id: '!room:example.test',
        },
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rejected: [] });
    expect(deliveries).toEqual([
      {
        accountRoute,
        eventId: '$event:example.test',
        kind: 'event',
        missedCalls: 0,
        platform: 'android',
        priority: 'high',
        pushKey,
        roomId: '!room:example.test',
        sound: false,
        unread: 0,
      },
    ]);
  });

  it('accepts an array counts value and applies zero-count defaults', async () => {
    const { deliveries, gateway } = recordingGateway();
    const response = await gateway.fetch(
      notifyRequest({
        notification: { counts: [], devices: [validClientInstallation()] },
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rejected: [] });
    expect(deliveries).toEqual([
      {
        accountRoute: 'account-route',
        kind: 'counts',
        missedCalls: 0,
        platform: 'android',
        priority: 'low',
        pushKey: 'fcm-push-key',
        sound: false,
        unread: 0,
      },
    ]);
  });

  it.each([
    [
      'non-string app ID',
      { ...validClientInstallation(), app_id: 7 },
      'fcm-push-key',
    ],
    [
      'unsupported app ID',
      { ...validClientInstallation(), app_id: 'future.app' },
      'fcm-push-key',
    ],
    [
      'non-object data',
      { ...validClientInstallation(), data: null },
      'fcm-push-key',
    ],
    [
      'unsupported data format',
      {
        ...validClientInstallation(),
        data: { ...validClientInstallation().data, format: 'full' },
      },
      'fcm-push-key',
    ],
    [
      'non-string account route',
      {
        ...validClientInstallation(),
        data: {
          ...validClientInstallation().data,
          trinity_account_id: 7,
        },
      },
      'fcm-push-key',
    ],
    [
      'empty account route',
      {
        ...validClientInstallation(),
        data: { ...validClientInstallation().data, trinity_account_id: '' },
      },
      'fcm-push-key',
    ],
    [
      'non-base64url account route',
      {
        ...validClientInstallation(),
        data: {
          ...validClientInstallation().data,
          trinity_account_id: 'matrix user id',
        },
      },
      'fcm-push-key',
    ],
    [
      'account route longer than 48 characters',
      {
        ...validClientInstallation(),
        data: {
          ...validClientInstallation().data,
          trinity_account_id: 'a'.repeat(49),
        },
      },
      'fcm-push-key',
    ],
    [
      'non-string push version',
      {
        ...validClientInstallation(),
        data: {
          ...validClientInstallation().data,
          trinity_push_version: 1,
        },
      },
      'fcm-push-key',
    ],
    [
      'unsupported push version',
      {
        ...validClientInstallation(),
        data: {
          ...validClientInstallation().data,
          trinity_push_version: '2',
        },
      },
      'fcm-push-key',
    ],
    ['empty push key', { ...validClientInstallation(), pushkey: '' }, ''],
    [
      'push key longer than 4096 characters',
      { ...validClientInstallation(), pushkey: 'p'.repeat(4097) },
      'p'.repeat(4097),
    ],
    [
      'push key longer than 4096 UTF-16 code units',
      { ...validClientInstallation(), pushkey: '😀'.repeat(2049) },
      '😀'.repeat(2049),
    ],
    [
      'non-string push key',
      { ...validClientInstallation(), pushkey: 7 },
      undefined,
    ],
  ] satisfies readonly [
    string,
    Readonly<Record<string, unknown>>,
    string | undefined,
  ][])(
    'rejects a client installation with %s',
    async (_description, clientInstallation, rejectedPushKey) => {
      const { deliveries, gateway } = recordingGateway();
      const response = await gateway.fetch(
        notifyRequest({ notification: { devices: [clientInstallation] } }),
        env,
        createExecutionContext(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        rejected: rejectedPushKey === undefined ? [] : [rejectedPushKey],
      });
      expect(deliveries).toEqual([]);
    },
  );

  it('starts the complete notification deadline at request entry', async () => {
    let clockReads = 0;
    let deliveryCalls = 0;
    const gateway = createGateway({
      fcmClient: {
        async send() {
          deliveryCalls += 1;
          return { kind: 'delivered' };
        },
      },
      now() {
        clockReads += 1;
        return clockReads === 1 ? 0 : 3_000;
      },
    });
    const response = await gateway.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({ notification: { devices: [] } }),
        method: 'POST',
      }),
      {
        ...env,
        TRINITY_PUSH_GATEWAY_REQUEST_DEADLINE_SECONDS: '2',
        TRINITY_PUSH_GATEWAY_UPSTREAM_TIMEOUT_SECONDS: '1',
      },
      createExecutionContext(),
    );

    expect(response.status).toBe(502);
    expect(deliveryCalls).toBe(0);
  });

  it('accepts a notification request with no client installations', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({ notification: { devices: [] } }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rejected: [] });
  });

  it('rejects an installation with a non-base64url account route', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({
          notification: {
            devices: [
              {
                app_id: 'ovh.qwky.trinity.android',
                data: {
                  format: 'event_id_only',
                  trinity_account_id: 'matrix user id',
                  trinity_push_version: '1',
                },
                pushkey: 'invalid-route-token',
              },
            ],
          },
        }),
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rejected: ['invalid-route-token'],
    });
  });

  it('rejects an invalid installation without blocking a valid peer', async () => {
    const deliveries: FcmDelivery[] = [];
    const gateway = createGateway({
      fcmClient: {
        async send(delivery) {
          deliveries.push(delivery);
          return { kind: 'delivered' };
        },
      },
      now: () => 2_000_000_000_000,
    });
    const response = await gateway.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({
          notification: {
            devices: [
              {
                app_id: 'ovh.qwky.trinity.android',
                data: {
                  format: 'event_id_only',
                  trinity_account_id: 'valid-route',
                  trinity_push_version: '1',
                },
                future_device_field: true,
                pushkey: 'valid-token',
              },
              {
                app_id: 'ovh.qwky.trinity.android',
                data: { format: 'unsupported' },
                pushkey: 'invalid-token',
              },
            ],
            future_notification_field: true,
          },
        }),
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      rejected: ['invalid-token'],
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.pushKey).toBe('valid-token');
  });

  it('translates a private Matrix event for the configured Android app', async () => {
    const deliveries: FcmDelivery[] = [];
    const gateway = createGateway({
      fcmClient: {
        async send(delivery) {
          deliveries.push(delivery);
          return { kind: 'delivered' };
        },
      },
      now: () => 2_000_000_000_000,
    });
    const response = await gateway.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({
          notification: {
            content: { body: 'must not be forwarded' },
            counts: { missed_calls: 1, unread: 2 },
            devices: [
              {
                app_id: 'ovh.qwky.trinity.android',
                data: {
                  format: 'event_id_only',
                  trinity_account_id: 'account-route',
                  trinity_push_version: '1',
                },
                pushkey: 'fcm-registration',
                tweaks: { highlight: true, sound: 'default' },
              },
            ],
            event_id: '$event:example.test',
            prio: 'high',
            room_id: '!room:example.test',
            sender: '@must-not-leak:example.test',
          },
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rejected: [] });
    expect(deliveries).toEqual([
      {
        accountRoute: 'account-route',
        eventId: '$event:example.test',
        highlight: true,
        kind: 'event',
        missedCalls: 1,
        platform: 'android',
        priority: 'high',
        pushKey: 'fcm-registration',
        roomId: '!room:example.test',
        sound: true,
        unread: 2,
      },
    ]);
  });

  it('logs aggregate outcomes without notification identifiers or secrets', async () => {
    const logs: unknown[] = [];
    const gateway = createGateway({
      fcmClient: {
        async send() {
          return { kind: 'delivered' };
        },
      },
      log(event) {
        logs.push(event);
      },
      now: () => 2_000_000_000_000,
    });
    const response = await gateway.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({
          notification: {
            content: { body: 'private-message-body' },
            devices: [
              {
                app_id: 'ovh.qwky.trinity.android',
                data: {
                  format: 'event_id_only',
                  trinity_account_id: 'private-account-route',
                  trinity_push_version: '1',
                },
                pushkey: 'private-fcm-token',
              },
            ],
            event_id: '$private-event:example.test',
            room_id: '!private-room:example.test',
            sender: '@private-sender:example.test',
          },
        }),
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      delivered: 1,
      event: 'notification_processed',
      rejected: 0,
      retryable: 0,
      total: 1,
    });
    const serializedLogs = JSON.stringify(logs);
    for (const secret of [
      'private-message-body',
      'private-account-route',
      'private-fcm-token',
      '$private-event:example.test',
      '!private-room:example.test',
      '@private-sender:example.test',
    ]) {
      expect(serializedLogs).not.toContain(secret);
    }
  });

  it('suppresses an ordinary retry of an event delivery', async () => {
    const deliveries: FcmDelivery[] = [];
    const gateway = createGateway({
      fcmClient: {
        async send(delivery) {
          deliveries.push(delivery);
          return { kind: 'delivered' };
        },
      },
      now: () => 2_000_000_000_000,
    });
    const body = JSON.stringify({
      notification: {
        devices: [
          {
            app_id: 'ovh.qwky.trinity.android',
            data: {
              format: 'event_id_only',
              trinity_account_id: 'account-route',
              trinity_push_version: '1',
            },
            pushkey: 'fcm-registration',
          },
        ],
        event_id: '$event:example.test',
        room_id: '!room:example.test',
      },
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await gateway.fetch(
        new Request('https://gateway.test/_matrix/push/v1/notify', {
          body,
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
        env,
        createExecutionContext(),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ rejected: [] });
    }

    expect(deliveries).toHaveLength(1);
  });

  it('asks a concurrent retry to wait while an event delivery is in progress', async () => {
    let releaseDelivery: (() => void) | undefined;
    const deliveryStarted = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    let sendCalls = 0;
    const gateway = createGateway({
      fcmClient: {
        async send() {
          sendCalls += 1;
          await deliveryStarted;
          return { kind: 'delivered' };
        },
      },
      now: () => 2_000_000_000_000,
    });
    const body = JSON.stringify({
      notification: {
        devices: [
          {
            app_id: 'ovh.qwky.trinity.android',
            data: {
              format: 'event_id_only',
              trinity_account_id: 'account-route',
              trinity_push_version: '1',
            },
            pushkey: 'fcm-registration',
          },
        ],
        event_id: '$event:example.test',
        room_id: '!room:example.test',
      },
    });
    const request = (): Request =>
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body,
        method: 'POST',
      });

    const firstResponse = gateway.fetch(
      request(),
      env,
      createExecutionContext(),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const concurrentResponse = await gateway.fetch(
      request(),
      env,
      createExecutionContext(),
    );

    expect(concurrentResponse.status).toBe(503);
    expect(concurrentResponse.headers.get('retry-after')).toBe('120');
    expect(sendCalls).toBe(1);
    releaseDelivery!();
    expect((await firstResponse).status).toBe(200);
  });

  it('retries only transient installations after a mixed FCM outcome', async () => {
    const attempts: string[] = [];
    let transientFailures = 1;
    const gateway = createGateway({
      fcmClient: {
        async send(delivery) {
          attempts.push(delivery.pushKey);
          if (delivery.pushKey === 'retry-token' && transientFailures > 0) {
            transientFailures -= 1;
            return { kind: 'transient', reason: 'unavailable' };
          }
          return { kind: 'delivered' };
        },
      },
      now: () => 2_000_000_000_000,
    });
    const body = JSON.stringify({
      notification: {
        devices: ['delivered-token', 'retry-token'].map((pushkey) => ({
          app_id: 'ovh.qwky.trinity.android',
          data: {
            format: 'event_id_only',
            trinity_account_id: 'account-route',
            trinity_push_version: '1',
          },
          pushkey,
        })),
        event_id: '$event:example.test',
        room_id: '!room:example.test',
      },
    });
    const request = (): Request =>
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body,
        method: 'POST',
      });

    const first = await gateway.fetch(request(), env, createExecutionContext());
    const retry = await gateway.fetch(request(), env, createExecutionContext());

    expect(first.status).toBe(502);
    expect(retry.status).toBe(200);
    expect(attempts).toEqual(['delivered-token', 'retry-token', 'retry-token']);
  });

  it('rejects an oversized body before delivery', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({ padding: 'x'.repeat(65_536) }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      errcode: 'M_TOO_LARGE',
      error: 'Request body is too large.',
    });
  });

  it('rejects more client installations than one free-tier request can deliver', async () => {
    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({
          notification: {
            devices: Array.from({ length: 50 }, (_, index) => ({
              app_id: 'ovh.qwky.trinity.android',
              data: {
                format: 'event_id_only',
                trinity_account_id: `account-${index}`,
                trinity_push_version: '1',
              },
              pushkey: `token-${index}`,
            })),
          },
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      errcode: 'M_TOO_LARGE',
      error: 'Too many client installations.',
    });
  });

  it('stops before FCM when the daily delivery budget is exhausted', async () => {
    const deliveries: FcmDelivery[] = [];
    const gateway = createGateway({
      fcmClient: {
        async send(delivery) {
          deliveries.push(delivery);
          return { kind: 'delivered' };
        },
      },
      now: () => Date.UTC(2033, 4, 18, 12),
    });
    const limitedEnv = {
      ...env,
      TRINITY_PUSH_GATEWAY_MAX_DAILY_ATTEMPTS: '1',
    } satisfies Env;
    const body = JSON.stringify({
      notification: {
        counts: { unread: 1 },
        devices: [
          {
            app_id: 'ovh.qwky.trinity.android',
            data: {
              format: 'event_id_only',
              trinity_account_id: 'account-route',
              trinity_push_version: '1',
            },
            pushkey: 'fcm-registration',
          },
        ],
      },
    });
    const request = (): Request =>
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body,
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });

    const accepted = await gateway.fetch(
      request(),
      limitedEnv,
      createExecutionContext(),
    );
    const limited = await gateway.fetch(
      request(),
      limitedEnv,
      createExecutionContext(),
    );

    expect(accepted.status).toBe(200);
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({
      errcode: 'M_LIMIT_EXCEEDED',
      error: 'Daily delivery budget exhausted.',
      retry_after_ms: 43_200_000,
    });
    expect(deliveries).toHaveLength(1);
  });

  it('rate limits a noisy homeserver before reading its request body', async () => {
    const limitedEnv = {
      ...env,
      TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMITER: {
        async limit() {
          return { success: false };
        },
      },
    } satisfies Env;

    const response = await worker.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: '{}',
        headers: { 'cf-connecting-ip': '192.0.2.1' },
        method: 'POST',
      }),
      limitedEnv,
      createExecutionContext(),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      errcode: 'M_LIMIT_EXCEEDED',
      error: 'Source rate limit exceeded.',
      retry_after_ms: 10_000,
    });
  });

  it('delivers in waves of no more than six FCM connections', async () => {
    let active = 0;
    let maximumActive = 0;
    const gateway = createGateway({
      fcmClient: {
        async send() {
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
          return { kind: 'delivered' };
        },
      },
      now: () => 2_000_000_000_000,
    });
    const response = await gateway.fetch(
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body: JSON.stringify({
          notification: {
            devices: Array.from({ length: 7 }, (_, index) => ({
              app_id: 'ovh.qwky.trinity.android',
              data: {
                format: 'event_id_only',
                trinity_account_id: `account-${index}`,
                trinity_push_version: '1',
              },
              pushkey: `token-${index}`,
            })),
          },
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(maximumActive).toBe(6);
  });

  it('exposes scheduled cleanup through the Worker handler', async () => {
    const gateway = createGateway({
      fcmClient: {
        async send() {
          return { kind: 'delivered' };
        },
      },
      now: () => Date.UTC(2033, 4, 18, 3),
    });
    const controller = {
      cron: '0 3 * * *',
      noRetry() {},
      scheduledTime: Date.UTC(2033, 4, 18, 3),
    } satisfies ScheduledController;

    expect(gateway.scheduled).toBeTypeOf('function');
    await gateway.scheduled!(controller, env, createExecutionContext());
  });

  it('allows an expired event to be delivered again after scheduled cleanup', async () => {
    let now = Date.UTC(2033, 4, 18, 3);
    let sendCalls = 0;
    const gateway = createGateway({
      fcmClient: {
        async send() {
          sendCalls += 1;
          return { kind: 'delivered' };
        },
      },
      now: () => now,
    });
    const body = JSON.stringify({
      notification: {
        devices: [
          {
            app_id: 'ovh.qwky.trinity.android',
            data: {
              format: 'event_id_only',
              trinity_account_id: 'account-route',
              trinity_push_version: '1',
            },
            pushkey: 'fcm-registration',
          },
        ],
        event_id: '$event:example.test',
        room_id: '!room:example.test',
      },
    });
    const request = (): Request =>
      new Request('https://gateway.test/_matrix/push/v1/notify', {
        body,
        method: 'POST',
      });

    expect(
      (await gateway.fetch(request(), env, createExecutionContext())).status,
    ).toBe(200);
    now += 86_401_000;
    await gateway.scheduled(
      {
        cron: '0 3 * * *',
        noRetry() {},
        scheduledTime: now,
      },
      env,
      createExecutionContext(),
    );
    expect(
      (await gateway.fetch(request(), env, createExecutionContext())).status,
    ).toBe(200);
    expect(sendCalls).toBe(2);
  });
});
