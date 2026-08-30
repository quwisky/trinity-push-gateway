import {
  array,
  literal,
  looseObject,
  maxLength,
  minLength,
  minValue,
  number,
  optional,
  picklist,
  pipe,
  regex,
  safeInteger,
  safeParse,
  string,
  unknown as unknownValue,
} from 'valibot';

import { version as gatewayVersion } from '../package.json';

import { createFcmClient } from './fcm';
import type {
  DeliveryPlatform,
  FcmClient,
  FcmDelivery,
  FcmOutcome,
} from './fcm';
import type { ConfigurationEnvironment } from './env';
import { runtimeConfig } from './config';
import type { RuntimeConfig } from './config';
import type { GatewayStore, SourceLimiter } from './ports';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
} as const;
const NOTIFY_PATH = '/_matrix/push/v1/notify';
const NON_NEGATIVE_INTEGER_SCHEMA = pipe(number(), safeInteger(), minValue(0));
const NOTIFICATION_REQUEST_SCHEMA = looseObject({
  notification: looseObject({
    counts: optional(
      looseObject({
        missed_calls: optional(NON_NEGATIVE_INTEGER_SCHEMA),
        unread: optional(NON_NEGATIVE_INTEGER_SCHEMA),
      }),
    ),
    devices: array(unknownValue()),
    event_id: optional(string()),
    prio: optional(picklist(['high', 'low'])),
    room_id: optional(string()),
  }),
});
const DEVICE_SCHEMA = looseObject({
  app_id: string(),
  data: looseObject({
    format: literal('event_id_only'),
    trinity_account_id: pipe(
      string(),
      regex(/^[A-Za-z0-9_-]+$/u),
      maxLength(48),
    ),
    trinity_push_version: literal('1'),
  }),
  pushkey: pipe(string(), minLength(1), maxLength(4096)),
  tweaks: optional(unknownValue()),
});

export type GatewayDependencies = {
  readonly fcmClient?: FcmClient;
  readonly log?: (event: GatewayLog) => void;
  readonly now: () => number;
};

type GatewayLog = {
  readonly correlationId: string;
  readonly delivered: number;
  readonly durationMs: number;
  readonly event: 'notification_processed';
  readonly rejected: number;
  readonly retryable: number;
  readonly total: number;
};

export type GatewayRuntimeEnvironment = ConfigurationEnvironment & {
  readonly limiter: SourceLimiter;
  readonly sourceKey: (request: Request) => string;
  readonly store: GatewayStore;
};

export type RuntimeGatewayHandler = {
  readonly cleanup: (
    env: GatewayRuntimeEnvironment,
    now: number,
  ) => Promise<void>;
  readonly fetch: (
    request: Request,
    env: GatewayRuntimeEnvironment,
  ) => Promise<Response>;
};

type ParsedNotification = {
  readonly devices: readonly unknown[];
  readonly eventId?: string;
  readonly missedCalls: number;
  readonly priority: 'high' | 'low';
  readonly roomId?: string;
  readonly unread: number;
};

type DeliveryEntry = {
  readonly delivery: FcmDelivery;
  readonly device: Readonly<Record<string, unknown>>;
};

type ProcessedOutcome =
  FcmOutcome | { readonly kind: 'pending'; readonly retryAfterSeconds: number };

type JsonBody =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'too-large' };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matrixError(
  status: number,
  errcode: string,
  error: string,
  additionalHeaders?: HeadersInit,
): Response {
  const headers = new Headers(JSON_HEADERS);
  if (additionalHeaders !== undefined) {
    for (const [name, value] of new Headers(additionalHeaders)) {
      headers.set(name, value);
    }
  }
  return Response.json(
    { errcode, error },
    {
      headers,
      status,
    },
  );
}

export function gatewayStorageUnavailableResponse(): Response {
  return matrixError(
    503,
    'M_UNKNOWN',
    'Gateway storage is temporarily unavailable.',
  );
}

function rateLimitResponse(error: string, retryAfterMs: number): Response {
  return Response.json(
    {
      errcode: 'M_LIMIT_EXCEEDED',
      error,
      retry_after_ms: retryAfterMs,
    },
    {
      headers: {
        ...JSON_HEADERS,
        'retry-after': String(Math.ceil(retryAfterMs / 1000)),
      },
      status: 429,
    },
  );
}

async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<JsonBody> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number.parseInt(contentLength, 10) > maxBytes) {
    return { kind: 'too-large' };
  }
  if (request.body === null) {
    return { kind: 'invalid' };
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return { kind: 'too-large' };
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      kind: 'ok',
      value: JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      ),
    };
  } catch {
    return { kind: 'invalid' };
  }
}

function parseNotification(body: unknown): ParsedNotification | undefined {
  const result = safeParse(NOTIFICATION_REQUEST_SCHEMA, body);
  if (!result.success) {
    return undefined;
  }
  const notification = result.output.notification;
  if (
    notification.event_id !== undefined &&
    notification.room_id === undefined
  ) {
    return undefined;
  }
  return {
    devices: notification.devices,
    ...(notification.event_id === undefined
      ? {}
      : { eventId: notification.event_id }),
    missedCalls: notification.counts?.missed_calls ?? 0,
    priority: notification.prio === 'low' ? 'low' : 'high',
    ...(notification.room_id === undefined
      ? {}
      : { roomId: notification.room_id }),
    unread: notification.counts?.unread ?? 0,
  };
}

function platformFor(
  appId: string,
  env: ConfigurationEnvironment,
): DeliveryPlatform | undefined {
  if (appId === env.ANDROID_APP_ID) {
    return 'android';
  }
  if (appId === env.IOS_APP_ID) {
    return 'ios';
  }
  return undefined;
}

function deliveryFor(
  device: unknown,
  notification: ParsedNotification,
  env: ConfigurationEnvironment,
): FcmDelivery | undefined {
  const result = safeParse(DEVICE_SCHEMA, device);
  if (!result.success) {
    return undefined;
  }
  const parsedDevice = result.output;
  const platform = platformFor(parsedDevice.app_id, env);
  if (platform === undefined) {
    return undefined;
  }
  const tweaks = isRecord(parsedDevice.tweaks) ? parsedDevice.tweaks : {};
  const deliveryBase = {
    accountRoute: parsedDevice.data.trinity_account_id,
    ...(typeof tweaks.highlight === 'boolean'
      ? { highlight: tweaks.highlight }
      : {}),
    missedCalls: notification.missedCalls,
    platform,
    priority:
      notification.eventId === undefined ? 'low' : notification.priority,
    pushKey: parsedDevice.pushkey,
    sound:
      notification.eventId !== undefined && typeof tweaks.sound === 'string',
    unread: notification.unread,
  } as const;
  if (notification.eventId === undefined || notification.roomId === undefined) {
    return { ...deliveryBase, kind: 'counts' };
  }
  return {
    ...deliveryBase,
    eventId: notification.eventId,
    kind: 'event',
    roomId: notification.roomId,
  };
}

function configuredFcmClient(
  env: ConfigurationEnvironment,
  now: () => number,
  timeoutMs: number,
): FcmClient {
  return createFcmClient({
    clientEmail: env.FCM_CLIENT_EMAIL,
    fetch,
    now,
    privateKey: env.FCM_PRIVATE_KEY,
    projectId: env.FCM_PROJECT_ID,
    timeoutMs,
  });
}

function transientResponse(outcome: FcmOutcome): Response {
  const retryAfterSeconds =
    outcome.kind === 'transient' ? outcome.retryAfterSeconds : undefined;
  return matrixError(
    502,
    'M_UNKNOWN',
    'Push provider temporarily unavailable.',
    retryAfterSeconds === undefined
      ? undefined
      : { 'retry-after': String(retryAfterSeconds) },
  );
}

async function processDelivery(
  entry: DeliveryEntry,
  env: GatewayRuntimeEnvironment,
  config: RuntimeConfig,
  fcmClient: FcmClient,
  now: number,
): Promise<ProcessedOutcome> {
  const { delivery, device } = entry;
  const nowSeconds = Math.floor(now / 1000);
  const claim =
    delivery.kind === 'event'
      ? await env.store.claimDelivery(
          {
            accountRoute: delivery.accountRoute,
            appId: String(device.app_id),
            eventId: delivery.eventId,
            pushKey: delivery.pushKey,
          },
          env.FINGERPRINT_KEY,
          nowSeconds,
          config.pendingLeaseSeconds,
        )
      : undefined;
  if (claim?.kind === 'delivered') {
    return { kind: 'delivered' };
  }
  if (claim?.kind === 'rejected') {
    return { kind: 'rejected', reason: 'unregistered' };
  }
  if (claim?.kind === 'pending') {
    return claim;
  }

  const outcome = await fcmClient.send(delivery);
  if (outcome.kind === 'rejected' && claim?.kind === 'acquired') {
    await env.store.completeDelivery(
      claim.fingerprint,
      'rejected',
      outcome.reason,
      nowSeconds + config.terminalRetentionSeconds,
    );
  } else if (outcome.kind === 'transient' && claim?.kind === 'acquired') {
    await env.store.releaseDelivery(claim.fingerprint);
  } else if (outcome.kind === 'delivered' && claim?.kind === 'acquired') {
    await env.store.completeDelivery(
      claim.fingerprint,
      'delivered',
      undefined,
      nowSeconds + config.terminalRetentionSeconds,
    );
  }
  return outcome;
}

export function createRuntimeGateway(
  dependencies: GatewayDependencies,
): RuntimeGatewayHandler {
  let isolateFcmClient: FcmClient | undefined;

  return {
    async fetch(request, env): Promise<Response> {
      const url = new URL(request.url);
      const config = runtimeConfig(env);

      if (request.method === 'GET' && url.pathname === '/health') {
        const ready = config !== undefined && (await env.store.ready());
        return Response.json(
          {
            status: ready ? 'ok' : 'error',
            version: gatewayVersion,
          },
          { headers: JSON_HEADERS, status: ready ? 200 : 503 },
        );
      }

      if (url.pathname === NOTIFY_PATH && request.method !== 'POST') {
        return matrixError(405, 'M_UNRECOGNIZED', 'Method not allowed.');
      }

      if (url.pathname !== NOTIFY_PATH) {
        return matrixError(404, 'M_UNRECOGNIZED', 'Unrecognized request.');
      }

      if (config === undefined) {
        return matrixError(503, 'M_UNKNOWN', 'Gateway is not configured.');
      }

      const sourceLimit = await env.limiter.limit(env.sourceKey(request));
      if (!sourceLimit.success) {
        return rateLimitResponse(
          'Source rate limit exceeded.',
          sourceLimit.retryAfterSeconds * 1000,
        );
      }

      const jsonBody = await readJsonBody(request, config.maxBodyBytes);
      if (jsonBody.kind === 'too-large') {
        return matrixError(413, 'M_TOO_LARGE', 'Request body is too large.');
      }
      if (jsonBody.kind === 'invalid') {
        return matrixError(
          400,
          'M_NOT_JSON',
          'Request body must be valid JSON.',
        );
      }

      const notification = parseNotification(jsonBody.value);
      if (notification === undefined) {
        return matrixError(
          400,
          'M_BAD_JSON',
          'Invalid Matrix notification request.',
        );
      }
      if (notification.devices.length > config.maxDevices) {
        return matrixError(
          413,
          'M_TOO_LARGE',
          'Too many client installations.',
        );
      }

      const rejected: string[] = [];
      const deliveries: DeliveryEntry[] = [];
      for (const device of notification.devices) {
        const delivery = deliveryFor(device, notification, env);
        if (delivery === undefined) {
          if (isRecord(device) && typeof device.pushkey === 'string') {
            rejected.push(device.pushkey);
          }
        } else if (isRecord(device)) {
          deliveries.push({ delivery, device });
        }
      }
      const now = dependencies.now();
      const correlationId = crypto.randomUUID();
      const logOutcome = (delivered: number, retryable: number): void => {
        dependencies.log?.({
          correlationId,
          delivered,
          durationMs: Math.max(0, dependencies.now() - now),
          event: 'notification_processed',
          rejected: rejected.length,
          retryable,
          total: notification.devices.length,
        });
      };
      const reserved = await env.store.reserveDailyAttempts(
        new Date(now).toISOString().slice(0, 10),
        deliveries.length,
        config.maxDailyAttempts,
      );
      if (!reserved) {
        const date = new Date(now);
        const nextMidnight = Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate() + 1,
        );
        return rateLimitResponse(
          'Daily delivery budget exhausted.',
          nextMidnight - now,
        );
      }
      const fcmClient =
        dependencies.fcmClient ??
        (isolateFcmClient ??= configuredFcmClient(
          env,
          dependencies.now,
          config.upstreamTimeoutSeconds * 1000,
        ));
      let delivered = 0;
      let retryable = 0;
      for (let offset = 0; offset < deliveries.length; offset += 6) {
        if (
          dependencies.now() + config.upstreamTimeoutSeconds * 1000 >
          now + config.requestDeadlineSeconds * 1000
        ) {
          logOutcome(delivered, deliveries.length - offset);
          return matrixError(
            502,
            'M_UNKNOWN',
            'Push provider temporarily unavailable.',
          );
        }
        const wave = deliveries.slice(offset, offset + 6);
        const outcomes = await Promise.all(
          wave.map((entry) =>
            processDelivery(entry, env, config, fcmClient, dependencies.now()),
          ),
        );
        let retryResponse: Response | undefined;
        for (let index = 0; index < outcomes.length; index += 1) {
          const outcome = outcomes[index];
          const entry = wave[index];
          if (outcome === undefined || entry === undefined) {
            throw new Error('Delivery wave result mismatch.');
          }
          const delivery = entry.delivery;
          if (outcome.kind === 'rejected') {
            rejected.push(delivery.pushKey);
          } else if (outcome.kind === 'transient') {
            retryable += 1;
            retryResponse ??= transientResponse(outcome);
          } else if (outcome.kind === 'pending') {
            retryable += 1;
            retryResponse ??= matrixError(
              503,
              'M_UNKNOWN',
              'Notification delivery is already in progress.',
              { 'retry-after': String(outcome.retryAfterSeconds) },
            );
          } else {
            delivered += 1;
          }
        }
        if (retryResponse !== undefined) {
          logOutcome(delivered, retryable);
          return retryResponse;
        }
      }

      logOutcome(delivered, retryable);
      return Response.json(
        { rejected },
        { headers: JSON_HEADERS, status: 200 },
      );
    },
    async cleanup(env, now): Promise<void> {
      const nowSeconds = Math.floor(now / 1000);
      const utcDate = new Date(now).toISOString().slice(0, 10);
      await env.store.cleanup(nowSeconds, utcDate);
    },
  };
}
