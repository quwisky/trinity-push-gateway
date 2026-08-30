import { importPKCS8 } from 'jose/key/import';
import { SignJWT } from 'jose/jwt/sign';
import {
  array,
  looseObject,
  minValue,
  number,
  optional,
  pipe,
  safeInteger,
  safeParse,
  string,
} from 'valibot';

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const OAUTH_URL = 'https://oauth2.googleapis.com/token';

const OAUTH_RESPONSE_SCHEMA = looseObject({
  access_token: string(),
  expires_in: pipe(number(), safeInteger(), minValue(1)),
});
const FCM_SUCCESS_RESPONSE_SCHEMA = looseObject({ name: string() });
const FCM_ERROR_RESPONSE_SCHEMA = looseObject({
  error: looseObject({
    details: optional(
      array(
        looseObject({
          '@type': optional(string()),
          errorCode: optional(string()),
        }),
      ),
    ),
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
  readonly send: (delivery: FcmDelivery) => Promise<FcmOutcome>;
};

export type FcmClientOptions = {
  readonly clientEmail: string;
  readonly fetch: typeof fetch;
  readonly now: () => number;
  readonly privateKey: string;
  readonly projectId: string;
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
  const result = safeParse(FCM_ERROR_RESPONSE_SCHEMA, value);
  return (
    result.success &&
    result.output.error.details?.some(
      (detail) =>
        detail['@type'] ===
          'type.googleapis.com/google.firebase.fcm.v1.FcmError' &&
        detail.errorCode === expected,
    ) === true
  );
}

async function requestAccessToken(
  options: FcmClientOptions,
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
  });
  const body: unknown = await response.json();
  const parsed = safeParse(OAUTH_RESPONSE_SCHEMA, body);
  if (!response.ok || !parsed.success) {
    throw new Error('FCM OAuth token request failed.');
  }
  return {
    expiresAt: options.now() + parsed.output.expires_in * 1000,
    value: parsed.output.access_token,
  };
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

  const getAccessToken = async (): Promise<AccessToken> => {
    if (
      accessToken !== undefined &&
      accessToken.expiresAt > options.now() + 60_000
    ) {
      return accessToken;
    }
    accessTokenRequest ??= requestAccessToken(options);
    try {
      accessToken = await accessTokenRequest;
      return accessToken;
    } finally {
      accessTokenRequest = undefined;
    }
  };

  return {
    async send(delivery): Promise<FcmOutcome> {
      let response: Response;
      try {
        const token = await getAccessToken();
        response = await options.fetch(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/messages:send`,
          {
            body: JSON.stringify(messageFor(delivery, options.now())),
            headers: {
              authorization: `Bearer ${token.value}`,
              'content-type': 'application/json; charset=utf-8',
            },
            method: 'POST',
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
      return safeParse(FCM_SUCCESS_RESPONSE_SCHEMA, body).success
        ? { kind: 'delivered' }
        : { kind: 'transient', reason: 'unavailable' };
    },
  };
}
