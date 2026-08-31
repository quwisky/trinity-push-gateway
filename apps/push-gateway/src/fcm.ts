import { importPKCS8 } from 'jose/key/import';
import { SignJWT } from 'jose/jwt/sign';
import * as z from 'zod/mini';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';

const OAUTH_RESPONSE_SCHEMA = z.looseObject({
  access_token: z.string(),
  expires_in: z.int().check(z.minimum(1)),
});
const FCM_SUCCESS_RESPONSE_SCHEMA = z.looseObject({ name: z.string() });
const FCM_ERROR_DETAIL_OBJECT_SCHEMA = z.looseObject({
  '@type': z.optional(z.string()),
  errorCode: z.optional(z.string()),
});
const FCM_ERROR_DETAIL_SCHEMA = z.union([
  FCM_ERROR_DETAIL_OBJECT_SCHEMA,
  z.array(z.unknown()),
]);
const FCM_ERROR_RESPONSE_SCHEMA = z.looseObject({
  error: z.looseObject({
    details: z.optional(z.array(FCM_ERROR_DETAIL_SCHEMA)),
  }),
});

export type DeliveryPriority = 'high' | 'low';
export type DeliveryPlatform = 'android' | 'ios';

type DeliveryBase = {
  readonly accountRoute: string;
  readonly highlight?: boolean;
  readonly missedCalls: number;
  readonly platform: DeliveryPlatform;
  readonly priority: DeliveryPriority;
  readonly pushKey: string;
  readonly sound: boolean;
  readonly unread: number;
};

export type FcmDelivery =
  | (DeliveryBase & {
      readonly eventId: string;
      readonly kind: 'event';
      readonly roomId: string;
    })
  | (DeliveryBase & {
      readonly kind: 'counts';
    });

export type FcmOutcome =
  | { readonly kind: 'delivered' }
  | {
      readonly kind: 'rejected';
      readonly reason: 'invalid-registration' | 'unregistered';
    }
  | {
      readonly kind: 'transient';
      readonly reason: 'unavailable';
      readonly retryAfterSeconds?: number;
    };

export type FcmClient = {
  readonly send: (
    delivery: FcmDelivery,
    deadlineMs?: number,
  ) => Promise<FcmOutcome>;
};

export type FirebaseValidationResult =
  | Readonly<{ kind: 'succeeded' }>
  | Readonly<{
      kind: 'failed';
      reason: 'access_denied' | 'request_rejected' | 'unavailable';
    }>;

export type FirebaseValidator = Readonly<{
  validate(deadlineMs: number): Promise<FirebaseValidationResult>;
}>;

export type FcmClientOptions = {
  readonly clientEmail: string;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly privateKey: string;
  readonly projectId: string;
  readonly timeoutMs?: number;
};

type AccessToken = {
  readonly expiresAt: number;
  readonly value: string;
};

async function signJwt(
  clientEmail: string,
  privateKeyPem: string,
  now: number,
): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const key = await importPKCS8(privateKeyPem, 'RS256');
  return new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setAudience(OAUTH_URL)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(key);
}

function hasFcmErrorCode(value: unknown, expected: string): boolean {
  const result = z.safeParse(FCM_ERROR_RESPONSE_SCHEMA, value);
  return (
    result.success &&
    result.data.error.details?.some(
      (detail) =>
        !Array.isArray(detail) &&
        detail['@type'] ===
          'type.googleapis.com/google.firebase.fcm.v1.FcmError' &&
        detail.errorCode === expected,
    ) === true
  );
}

async function requestAccessToken(
  options: FcmClientOptions,
  deadlineMs?: number,
): Promise<AccessToken> {
  const assertion = await signJwt(
    options.clientEmail,
    options.privateKey,
    options.now(),
  );
  const response = await options.fetch(OAUTH_URL, {
    body: new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: requestSignal(options, deadlineMs),
  });
  const body: unknown = await response.json();
  const parsed = z.safeParse(OAUTH_RESPONSE_SCHEMA, body);
  if (!response.ok || !parsed.success) {
    throw new Error('FCM OAuth token request failed.');
  }
  return {
    expiresAt: options.now() + parsed.data.expires_in * 1000,
    value: parsed.data.access_token,
  };
}

function requestSignal(
  options: FcmClientOptions,
  deadlineMs: number | undefined,
): AbortSignal {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const remainingMs =
    deadlineMs === undefined ? timeoutMs : deadlineMs - options.now();
  if (remainingMs <= 0) {
    throw new Error('Gateway request deadline exceeded.');
  }
  return AbortSignal.timeout(Math.min(timeoutMs, remainingMs));
}

function parseRetryAfter(
  value: string | null,
  now: number,
): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (/^\d+$/u.test(value)) {
    const delay = Number(value);
    return Number.isSafeInteger(delay) ? delay : undefined;
  }
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt)
    ? undefined
    : Math.max(0, Math.ceil((retryAt - now) / 1000));
}

function deliveryData(delivery: FcmDelivery): Readonly<Record<string, string>> {
  return {
    ...(delivery.kind === 'event'
      ? { event_id: delivery.eventId, room_id: delivery.roomId }
      : {}),
    ...(delivery.highlight === undefined
      ? {}
      : { highlight: String(delivery.highlight) }),
    kind: delivery.kind,
    missed_calls: String(delivery.missedCalls),
    schema: '1',
    sound: String(delivery.kind === 'event' && delivery.sound),
    trinity_account_id: delivery.accountRoute,
    unread: String(delivery.unread),
  };
}

function platformConfig(
  delivery: FcmDelivery,
  now: number,
): Readonly<Record<string, unknown>> {
  if (delivery.platform === 'android') {
    return {
      android: {
        ...(delivery.kind === 'counts'
          ? { collapse_key: `counts-${delivery.accountRoute}` }
          : {}),
        priority:
          delivery.kind === 'event' && delivery.priority === 'high'
            ? 'high'
            : 'normal',
        ttl: '3600s',
      },
    };
  }

  const isEvent = delivery.kind === 'event';
  return {
    apns: {
      headers: {
        ...(isEvent
          ? {}
          : { 'apns-collapse-id': `counts-${delivery.accountRoute}` }),
        'apns-expiration': String(Math.floor(now / 1000) + 3600),
        'apns-priority': isEvent && delivery.priority === 'high' ? '10' : '5',
        'apns-push-type': isEvent ? 'alert' : 'background',
      },
      payload: {
        aps: {
          ...(isEvent
            ? {
                alert: {
                  'loc-key': 'TRINITY_NEW_MESSAGE',
                  'title-loc-key': 'TRINITY_NOTIFICATION_TITLE',
                },
              }
            : {}),
          badge: delivery.unread,
          'content-available': 1,
          ...(isEvent ? { 'mutable-content': 1 } : {}),
          ...(isEvent && delivery.sound ? { sound: 'default' } : {}),
        },
      },
    },
  };
}

function messageFor(
  delivery: FcmDelivery,
  now: number,
): Readonly<Record<string, unknown>> {
  return {
    message: {
      ...platformConfig(delivery, now),
      data: deliveryData(delivery),
      token: delivery.pushKey,
    },
  };
}

export function createFcmClient(options: FcmClientOptions): FcmClient {
  let accessToken: AccessToken | undefined;
  let accessTokenRequest: Promise<AccessToken> | undefined;

  const getAccessToken = async (deadlineMs?: number): Promise<AccessToken> => {
    if (
      accessToken !== undefined &&
      accessToken.expiresAt > options.now() + 60_000
    ) {
      return accessToken;
    }
    accessTokenRequest ??= requestAccessToken(options, deadlineMs);
    try {
      accessToken = await accessTokenRequest;
      return accessToken;
    } finally {
      accessTokenRequest = undefined;
    }
  };

  return {
    async send(delivery, deadlineMs): Promise<FcmOutcome> {
      let response: Response;
      try {
        const token = await getAccessToken(deadlineMs);
        response = await options.fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/messages:send`,
          {
            body: JSON.stringify(messageFor(delivery, options.now())),
            headers: {
              authorization: `Bearer ${token.value}`,
              'content-type': 'application/json; charset=utf-8',
            },
            method: 'POST',
            signal: requestSignal(options, deadlineMs),
          },
        );
      } catch {
        return { kind: 'transient', reason: 'unavailable' };
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          accessToken = undefined;
        }
        const body: unknown = await response.json().catch(() => undefined);
        if (hasFcmErrorCode(body, 'UNREGISTERED')) {
          return { kind: 'rejected', reason: 'unregistered' };
        }
        if (hasFcmErrorCode(body, 'INVALID_ARGUMENT')) {
          return { kind: 'rejected', reason: 'invalid-registration' };
        }
        const retryAfterSeconds = parseRetryAfter(
          response.headers.get('retry-after'),
          options.now(),
        );
        return {
          kind: 'transient',
          reason: 'unavailable',
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        };
      }
      const body: unknown = await response.json().catch(() => undefined);
      return z.safeParse(FCM_SUCCESS_RESPONSE_SCHEMA, body).success
        ? { kind: 'delivered' }
        : { kind: 'transient', reason: 'unavailable' };
    },
  };
}

export function createFirebaseValidator(
  options: FcmClientOptions,
): FirebaseValidator {
  return Object.freeze({
    async validate(deadlineMs): Promise<FirebaseValidationResult> {
      let response: Response;
      try {
        const token = await requestAccessToken(options, deadlineMs);
        response = await options.fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/messages:send`,
          {
            body: JSON.stringify({
              message: { token: 'trinity-push-gateway-validation-only' },
              validate_only: true,
            }),
            headers: {
              authorization: `Bearer ${token.value}`,
              'content-type': 'application/json; charset=utf-8',
            },
            method: 'POST',
            signal: requestSignal(options, deadlineMs),
          },
        );
      } catch {
        return { kind: 'failed', reason: 'unavailable' };
      }
      if (response.ok) {
        return { kind: 'succeeded' };
      }
      const body: unknown = await response.json().catch(() => undefined);
      if (
        hasFcmErrorCode(body, 'INVALID_ARGUMENT') ||
        hasFcmErrorCode(body, 'UNREGISTERED')
      ) {
        return { kind: 'succeeded' };
      }
      if (response.status === 401 || response.status === 403) {
        return { kind: 'failed', reason: 'access_denied' };
      }
      return response.status === 429 || response.status >= 500
        ? { kind: 'failed', reason: 'unavailable' }
        : { kind: 'failed', reason: 'request_rejected' };
    },
  });
}
