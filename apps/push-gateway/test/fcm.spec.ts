import { beforeAll, describe, expect, it } from 'vitest';

import {
  createFcmClient,
  createFirebaseValidator,
  type FcmClient,
} from '../src/fcm';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function createSigningKey(): Promise<{
  privateKeyPem: string;
  publicKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(
    {
      hash: 'SHA-256',
      modulusLength: 2048,
      name: 'RSASSA-PKCS1-v1_5',
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  );
  const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const base64 = bytesToBase64(new Uint8Array(privateKey));
  const lines = base64.match(/.{1,64}/g) ?? [];
  return {
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`,
    publicKey: keyPair.publicKey,
  };
}

async function createPrivateKeyPem(): Promise<string> {
  return (await createSigningKey()).privateKeyPem;
}

function decodeJwtPart(encoded: string): unknown {
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return JSON.parse(atob(padded));
}

function decodeBase64Url(encoded: string): Uint8Array<ArrayBuffer> {
  const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

const countsDelivery = {
  accountRoute: 'account-route',
  kind: 'counts',
  missedCalls: 0,
  platform: 'android',
  priority: 'low',
  pushKey: 'fcm-registration',
  sound: false,
  unread: 1,
} as const;

type SchemaResponseClient = Readonly<{
  client: FcmClient;
  messageAuthorization: () => string | null;
  messageRequests: () => number;
}>;

let schemaPrivateKeyPem = '';

function schemaResponseClient(
  oauthBody: unknown,
  fcmBody: unknown,
  fcmStatus = 200,
): SchemaResponseClient {
  let authorization: string | null = null;
  let requests = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === 'https://oauth2.googleapis.com/token') {
      return Response.json(oauthBody);
    }
    requests += 1;
    authorization = request.headers.get('authorization');
    return Response.json(fcmBody, { status: fcmStatus });
  };
  return {
    client: createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: schemaPrivateKeyPem,
      projectId: 'test-project',
    }),
    messageAuthorization: () => authorization,
    messageRequests: () => requests,
  };
}

describe('FCM adapter', () => {
  beforeAll(async () => {
    schemaPrivateKeyPem = await createPrivateKeyPem();
  });

  it('validates access without using a real installation or claiming delivery', async () => {
    let validationBody: unknown;
    const validator = createFirebaseValidator({
      clientEmail: 'gateway@example.test',
      fetch: async (input, init) => {
        const request = new Request(input, init);
        if (request.url === 'https://oauth2.googleapis.com/token') {
          return Response.json({ access_token: 'token', expires_in: 3600 });
        }
        validationBody = await request.json();
        return Response.json(
          {
            error: {
              details: [
                {
                  '@type':
                    'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                  errorCode: 'INVALID_ARGUMENT',
                },
              ],
            },
          },
          { status: 400 },
        );
      },
      now: () => 2_000_000_000_000,
      privateKey: schemaPrivateKeyPem,
      projectId: 'test-project',
    });

    await expect(validator.validate(2_000_000_020_000)).resolves.toEqual({
      kind: 'succeeded',
    });
    expect(validationBody).toEqual({
      message: { token: 'trinity-push-gateway-validation-only' },
      validate_only: true,
    });
  });

  it('does not confuse a malformed dry-run request with FCM access', async () => {
    const validator = createFirebaseValidator({
      clientEmail: 'gateway@example.test',
      fetch: async (input) =>
        new URL(new Request(input).url).hostname === 'oauth2.googleapis.com'
          ? Response.json({ access_token: 'token', expires_in: 3600 })
          : Response.json(
              {
                error: {
                  details: [
                    {
                      '@type': 'type.googleapis.com/google.rpc.BadRequest',
                    },
                  ],
                },
              },
              { status: 400 },
            ),
      now: () => 2_000_000_000_000,
      privateKey: schemaPrivateKeyPem,
      projectId: 'test-project',
    });

    await expect(validator.validate(2_000_000_020_000)).resolves.toEqual({
      kind: 'failed',
      reason: 'request_rejected',
    });
  });

  it('shares one OAuth refresh across concurrent deliveries', async () => {
    let oauthRequests = 0;
    let messageRequests = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : new Request(input).url,
      );
      if (url.origin === 'https://oauth2.googleapis.com') {
        oauthRequests += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      messageRequests += 1;
      return Response.json({ name: `message-${messageRequests}` });
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });
    const delivery = {
      accountRoute: 'account-route',
      kind: 'counts',
      missedCalls: 0,
      platform: 'android',
      priority: 'low',
      sound: false,
      unread: 1,
    } as const;

    await Promise.all([
      client.send({ ...delivery, pushKey: 'token-one' }),
      client.send({ ...delivery, pushKey: 'token-two' }),
    ]);

    expect(oauthRequests).toBe(1);
    expect(messageRequests).toBe(2);
  });

  it('authorizes and sends a private Android event delivery', async () => {
    const signingKey = await createSigningKey();
    const requests: Request<unknown, unknown>[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());

      if (request.url === 'https://oauth2.googleapis.com/token') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }

      return Response.json({
        name: 'projects/test-project/messages/message-1',
      });
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: signingKey.privateKeyPem,
      projectId: 'test-project',
    });

    await expect(
      client.send({
        accountRoute: 'account-route',
        eventId: '$event:example.test',
        highlight: true,
        kind: 'event',
        missedCalls: 0,
        platform: 'android',
        priority: 'high',
        pushKey: 'fcm-registration',
        roomId: '!room:example.test',
        sound: true,
        unread: 2,
      }),
    ).resolves.toEqual({ kind: 'delivered' });

    expect(requests).toHaveLength(2);
    const tokenBody = new URLSearchParams(
      new TextDecoder().decode(await requests[0]!.arrayBuffer()),
    );
    expect(tokenBody.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    const assertion = tokenBody.get('assertion');
    expect(assertion).not.toBeNull();
    const jwtParts = assertion!.split('.');
    expect(decodeJwtPart(jwtParts[0]!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeJwtPart(jwtParts[1]!)).toEqual({
      aud: 'https://oauth2.googleapis.com/token',
      exp: 2_000_003_600,
      iat: 2_000_000_000,
      iss: 'gateway@example.test',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    });
    await expect(
      crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        signingKey.publicKey,
        decodeBase64Url(jwtParts[2]!),
        new TextEncoder().encode(`${jwtParts[0]}.${jwtParts[1]}`),
      ),
    ).resolves.toBe(true);

    expect(requests[1]!.url).toBe(
      'https://fcm.googleapis.com/v1/projects/test-project/messages:send',
    );
    expect(requests[1]!.headers.get('authorization')).toBe(
      'Bearer access-token',
    );
    await expect(requests[1]!.json()).resolves.toEqual({
      message: {
        android: { priority: 'high', ttl: '3600s' },
        data: {
          event_id: '$event:example.test',
          highlight: 'true',
          kind: 'event',
          missed_calls: '0',
          room_id: '!room:example.test',
          schema: '1',
          sound: 'true',
          trinity_account_id: 'account-route',
          unread: '2',
        },
        token: 'fcm-registration',
      },
    });
  });

  it('reports an unregistered installation as rejected', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : new Request(input).url,
      );
      if (url.origin === 'https://oauth2.googleapis.com') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return Response.json(
        {
          error: {
            code: 404,
            details: [
              [],
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'UNREGISTERED',
                future_detail_field: true,
              },
            ],
            future_error_field: true,
            message: 'Requested entity was not found.',
            status: 'NOT_FOUND',
          },
          future_response_field: true,
        },
        { status: 404 },
      );
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await expect(
      client.send({
        accountRoute: 'account-route',
        eventId: '$event:example.test',
        kind: 'event',
        missedCalls: 0,
        platform: 'android',
        priority: 'high',
        pushKey: 'unregistered-token',
        roomId: '!room:example.test',
        sound: false,
        unread: 1,
      }),
    ).resolves.toEqual({ kind: 'rejected', reason: 'unregistered' });
  });

  it('rejects only an explicitly token-specific invalid argument', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : new Request(input).url,
      );
      if (url.origin === 'https://oauth2.googleapis.com') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return Response.json(
        {
          error: {
            code: 400,
            details: [
              {
                '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
                errorCode: 'INVALID_ARGUMENT',
              },
            ],
            status: 'INVALID_ARGUMENT',
          },
        },
        { status: 400 },
      );
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await expect(
      client.send({
        accountRoute: 'account-route',
        kind: 'counts',
        missedCalls: 0,
        platform: 'android',
        priority: 'low',
        pushKey: 'invalid-token',
        sound: false,
        unread: 0,
      }),
    ).resolves.toEqual({
      kind: 'rejected',
      reason: 'invalid-registration',
    });
  });

  it.each([
    [
      'details is not an array',
      {
        error: {
          details: {
            '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
            errorCode: 'UNREGISTERED',
          },
        },
      },
    ],
    ['a detail is null', { error: { details: [null] } }],
    [
      'the detail type is not a string',
      { error: { details: [{ '@type': 7, errorCode: 'UNREGISTERED' }] } },
    ],
    [
      'the detail code is not a string',
      {
        error: {
          details: [
            {
              '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
              errorCode: 7,
            },
          ],
        },
      },
    ],
  ] satisfies readonly [string, unknown][])(
    'does not reject a Push Key when FCM error %s',
    async (_description, fcmBody) => {
      const responseClient = schemaResponseClient(
        { access_token: 'access-token', expires_in: 3600 },
        fcmBody,
        400,
      );

      await expect(responseClient.client.send(countsDelivery)).resolves.toEqual(
        { kind: 'transient', reason: 'unavailable' },
      );
    },
  );

  it('preserves retry guidance for a transient FCM failure', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : new Request(input).url,
      );
      if (url.origin === 'https://oauth2.googleapis.com') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return Response.json(
        { error: { code: 503, status: 'UNAVAILABLE' } },
        { headers: { 'retry-after': '120' }, status: 503 },
      );
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await expect(
      client.send({
        accountRoute: 'account-route',
        eventId: '$event:example.test',
        kind: 'event',
        missedCalls: 0,
        platform: 'ios',
        priority: 'high',
        pushKey: 'fcm-registration',
        roomId: '!room:example.test',
        sound: false,
        unread: 1,
      }),
    ).resolves.toEqual({
      kind: 'transient',
      reason: 'unavailable',
      retryAfterSeconds: 120,
    });
  });

  it('converts an HTTP-date Retry-After value to seconds', async () => {
    const now = 2_000_000_000_000;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : new Request(input).url,
      );
      if (url.origin === 'https://oauth2.googleapis.com') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return Response.json(
        { error: { code: 503, status: 'UNAVAILABLE' } },
        {
          headers: { 'retry-after': new Date(now + 120_000).toUTCString() },
          status: 503,
        },
      );
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => now,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await expect(
      client.send({
        accountRoute: 'account-route',
        kind: 'counts',
        missedCalls: 0,
        platform: 'android',
        priority: 'low',
        pushKey: 'fcm-registration',
        sound: false,
        unread: 1,
      }),
    ).resolves.toEqual({
      kind: 'transient',
      reason: 'unavailable',
      retryAfterSeconds: 120,
    });
  });

  it.each([
    ['name is missing', { unexpected: true }],
    ['name is not a string', { name: 7 }],
    ['body is null', null],
  ] satisfies readonly [string, unknown][])(
    'treats a successful FCM response whose %s as retryable',
    async (_description, fcmBody) => {
      const responseClient = schemaResponseClient(
        { access_token: 'access-token', expires_in: 3600 },
        fcmBody,
      );

      await expect(responseClient.client.send(countsDelivery)).resolves.toEqual(
        { kind: 'transient', reason: 'unavailable' },
      );
    },
  );

  it.each([
    ['access token is missing', { expires_in: 3600 }],
    ['access token is not a string', { access_token: 7, expires_in: 3600 }],
    ['expiration is missing', { access_token: 'access-token' }],
    [
      'expiration is not a number',
      { access_token: 'access-token', expires_in: '3600' },
    ],
    ['expiration is zero', { access_token: 'access-token', expires_in: 0 }],
    [
      'expiration is fractional',
      { access_token: 'access-token', expires_in: 1.5 },
    ],
    [
      'expiration exceeds the safe-integer range',
      { access_token: 'access-token', expires_in: 9_007_199_254_740_992 },
    ],
  ] satisfies readonly [string, unknown][])(
    'treats an OAuth response whose %s as retryable',
    async (_description, oauthBody) => {
      const responseClient = schemaResponseClient(oauthBody, {
        name: 'must-not-send',
      });

      await expect(responseClient.client.send(countsDelivery)).resolves.toEqual(
        { kind: 'transient', reason: 'unavailable' },
      );
      expect(responseClient.messageRequests()).toBe(0);
    },
  );

  it('accepts loose OAuth and FCM responses at their empty and minimum bounds', async () => {
    const responseClient = schemaResponseClient(
      {
        access_token: '',
        expires_in: 1,
        future_oauth_field: true,
      },
      { future_fcm_field: true, name: '' },
    );

    await expect(responseClient.client.send(countsDelivery)).resolves.toEqual({
      kind: 'delivered',
    });
    expect(responseClient.messageRequests()).toBe(1);
    expect(responseClient.messageAuthorization()).toBe('Bearer');
  });

  it('refreshes OAuth credentials after an authentication failure', async () => {
    let oauthRequests = 0;
    let messageRequests = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : new Request(input).url,
      );
      if (url.origin === 'https://oauth2.googleapis.com') {
        oauthRequests += 1;
        return Response.json({
          access_token: `access-token-${oauthRequests}`,
          expires_in: 3600,
        });
      }
      messageRequests += 1;
      return messageRequests === 1
        ? Response.json(
            { error: { status: 'UNAUTHENTICATED' } },
            { status: 401 },
          )
        : Response.json({ name: 'message-2' });
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });
    const delivery = {
      accountRoute: 'account-route',
      kind: 'counts',
      missedCalls: 0,
      platform: 'android',
      priority: 'low',
      pushKey: 'fcm-registration',
      sound: false,
      unread: 1,
    } as const;

    await expect(client.send(delivery)).resolves.toEqual({
      kind: 'transient',
      reason: 'unavailable',
    });
    await expect(client.send(delivery)).resolves.toEqual({ kind: 'delivered' });
    expect(oauthRequests).toBe(2);
  });

  it('classifies a provider network failure as retryable', async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(
        typeof input === 'string' ? input : new Request(input).url,
      );
      if (url.origin === 'https://oauth2.googleapis.com') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      throw new TypeError('network unavailable');
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await expect(
      client.send({
        accountRoute: 'account-route',
        kind: 'counts',
        missedCalls: 0,
        platform: 'android',
        priority: 'low',
        pushKey: 'fcm-registration',
        sound: false,
        unread: 1,
      }),
    ).resolves.toEqual({ kind: 'transient', reason: 'unavailable' });
  });

  it('sends an iOS event with a private localized fallback', async () => {
    const requests: Request<unknown, unknown>[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (request.url === 'https://oauth2.googleapis.com/token') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return Response.json({ name: 'message-1' });
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await client.send({
      accountRoute: 'account-route',
      eventId: '$event:example.test',
      kind: 'event',
      missedCalls: 1,
      platform: 'ios',
      priority: 'high',
      pushKey: 'ios-fcm-registration',
      roomId: '!room:example.test',
      sound: true,
      unread: 3,
    });

    await expect(requests[1]!.json()).resolves.toEqual({
      message: {
        apns: {
          headers: {
            'apns-expiration': '2000003600',
            'apns-priority': '10',
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              alert: {
                'loc-key': 'TRINITY_NEW_MESSAGE',
                'title-loc-key': 'TRINITY_NOTIFICATION_TITLE',
              },
              badge: 3,
              'content-available': 1,
              'mutable-content': 1,
              sound: 'default',
            },
          },
        },
        data: {
          event_id: '$event:example.test',
          kind: 'event',
          missed_calls: '1',
          room_id: '!room:example.test',
          schema: '1',
          sound: 'true',
          trinity_account_id: 'account-route',
          unread: '3',
        },
        token: 'ios-fcm-registration',
      },
    });
  });

  it('sends a silent collapsible iOS count update', async () => {
    const requests: Request<unknown, unknown>[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (request.url === 'https://oauth2.googleapis.com/token') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return Response.json({ name: 'message-1' });
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await client.send({
      accountRoute: 'account-route',
      kind: 'counts',
      missedCalls: 0,
      platform: 'ios',
      priority: 'high',
      pushKey: 'ios-fcm-registration',
      sound: true,
      unread: 0,
    });

    await expect(requests[1]!.json()).resolves.toEqual({
      message: {
        apns: {
          headers: {
            'apns-collapse-id': 'counts-account-route',
            'apns-expiration': '2000003600',
            'apns-priority': '5',
            'apns-push-type': 'background',
          },
          payload: {
            aps: {
              badge: 0,
              'content-available': 1,
            },
          },
        },
        data: {
          kind: 'counts',
          missed_calls: '0',
          schema: '1',
          sound: 'false',
          trinity_account_id: 'account-route',
          unread: '0',
        },
        token: 'ios-fcm-registration',
      },
    });
  });

  it('sends a normal-priority collapsible Android count update', async () => {
    const requests: Request<unknown, unknown>[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());
      if (request.url === 'https://oauth2.googleapis.com/token') {
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return Response.json({ name: 'message-1' });
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
    });

    await client.send({
      accountRoute: 'account-route',
      kind: 'counts',
      missedCalls: 2,
      platform: 'android',
      priority: 'high',
      pushKey: 'android-fcm-registration',
      sound: true,
      unread: 4,
    });

    await expect(requests[1]!.json()).resolves.toMatchObject({
      message: {
        android: {
          collapse_key: 'counts-account-route',
          priority: 'normal',
          ttl: '3600s',
        },
      },
    });
  });

  it('classifies an upstream timeout as a transient failure', async () => {
    const fetcher: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => 2_000_000_000_000,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
      timeoutMs: 1,
    });

    await expect(
      client.send({
        accountRoute: 'account-route',
        kind: 'counts',
        missedCalls: 0,
        platform: 'android',
        priority: 'low',
        pushKey: 'registration',
        sound: false,
        unread: 0,
      }),
    ).resolves.toEqual({ kind: 'transient', reason: 'unavailable' });
  });

  it('caps successive OAuth and FCM calls at the overall request deadline', async () => {
    let now = 2_000_000_000_000;
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.url === 'https://oauth2.googleapis.com/token') {
        now += 8;
        return Response.json({
          access_token: 'access-token',
          expires_in: 3600,
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('overall deadline reached'));
        });
      });
    };
    const client = createFcmClient({
      clientEmail: 'gateway@example.test',
      fetch: fetcher,
      now: () => now,
      privateKey: await createPrivateKeyPem(),
      projectId: 'test-project',
      timeoutMs: 1_000,
    });

    await expect(
      client.send(
        {
          accountRoute: 'account-route',
          kind: 'counts',
          missedCalls: 0,
          platform: 'android',
          priority: 'low',
          pushKey: 'registration',
          sound: false,
          unread: 0,
        },
        now + 10,
      ),
    ).resolves.toEqual({ kind: 'transient', reason: 'unavailable' });
  });
});
