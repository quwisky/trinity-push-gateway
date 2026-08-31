import * as z from 'zod/mini';

import { version as gatewayVersion } from '../../../package.json';

import {
  runtimeConfig,
  type ConfigurationEnvironment,
  type RuntimeConfig,
} from './config';
import { createFcmClient } from './fcm';
import type {
  DeliveryPlatform,
  FcmClient,
  FcmDelivery,
  FcmOutcome,
} from './fcm';
import type { GatewayStore, SourceLimiter } from './ports';
import type { GatewayMetricsSink } from './metrics';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
} as const;
const NOTIFY_PATH = '/_matrix/push/v1/notify';
const NON_NEGATIVE_INTEGER_SCHEMA = z.int().check(z.nonnegative());
const COUNTS_OBJECT_SCHEMA = z.looseObject({
  missed_calls: z.optional(NON_NEGATIVE_INTEGER_SCHEMA),
  unread: z.optional(NON_NEGATIVE_INTEGER_SCHEMA),
});
const COUNTS_SCHEMA = z.union([COUNTS_OBJECT_SCHEMA, z.array(z.unknown())]);
const NOTIFICATION_REQUEST_SCHEMA = z.looseObject({
  notification: z.looseObject({
    counts: z.optional(COUNTS_SCHEMA),
    devices: z.array(z.unknown()),
    event_id: z.optional(z.string()),
    prio: z.optional(z.enum(['high', 'low'])),
    room_id: z.optional(z.string()),
  }),
});
const CLIENT_INSTALLATION_SCHEMA = z.looseObject({
  app_id: z.string(),
  data: z.looseObject({
    format: z.literal('event_id_only'),
    trinity_account_id: z
      .string()
      .check(z.regex(/^[A-Za-z0-9_-]+$/u), z.maxLength(48)),
    trinity_push_version: z.literal('1'),
  }),
  pushkey: z.string().check(
    z.minLength(1),
    z.refine<string>((value) => value.length <= 4096),
  ),
  tweaks: z.optional(z.unknown()),
});

export type GatewayDependencies = {
  readonly fcmClient?: FcmClient;
  readonly log?: (event: GatewayLog) => void;
  readonly metrics?: GatewayMetricsSink;
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
  readonly clientInstallation: Readonly<Record<string, unknown>>;
  readonly delivery: FcmDelivery;
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

async function responseBeforeDeadline(
  operation: () => Promise<Response>,
  deadlineMs: number,
  now: () => number,
  abort: () => void,
): Promise<Response> {
  const remainingMs = deadlineMs - now();
  if (remainingMs <= 0) {
    abort();
    return transientResponse({ kind: 'transient', reason: 'unavailable' });
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadlineResponse = new Promise<Response>((resolve) => {
    timeout = setTimeout(() => {
      abort();
      resolve(transientResponse({ kind: 'transient', reason: 'unavailable' }));
    }, remainingMs);
  });
  try {
    return await Promise.race([operation(), deadlineResponse]);
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonBody(
  request: Request,
  maxBytes: number,
  signal: AbortSignal,
): Promise<JsonBody> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null && Number.parseInt(contentLength, 10) > maxBytes) {
    return { kind: 'too-large' };
  }
  if (request.body === null) {
    return { kind: 'invalid' };
  }
  const reader = request.body.getReader();
  const cancelReader = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) {
    cancelReader();
    return { kind: 'invalid' };
  }
  signal.addEventListener('abort', cancelReader, { once: true });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
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
  } finally {
    signal.removeEventListener('abort', cancelReader);
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
  const result = z.safeParse(NOTIFICATION_REQUEST_SCHEMA, body);
  if (!result.success) {
    return undefined;
  }
  const notification = result.data.notification;
  if (
    notification.event_id !== undefined &&
    notification.room_id === undefined
  ) {
    return undefined;
  }
  const counts = Array.isArray(notification.counts)
    ? undefined
    : notification.counts;
  return {
    devices: notification.devices,
    ...(notification.event_id === undefined
      ? {}
      : { eventId: notification.event_id }),
    missedCalls: counts?.missed_calls ?? 0,
    priority: notification.prio === 'low' ? 'low' : 'high',
    ...(notification.room_id === undefined
      ? {}
      : { roomId: notification.room_id }),
    unread: counts?.unread ?? 0,
  };
}

function platformFor(
  appId: string,
  env: ConfigurationEnvironment,
): DeliveryPlatform | undefined {
  if (appId === env.TRINITY_PUSH_GATEWAY_ANDROID_APP_ID) {
    return 'android';
  }
  if (appId === env.TRINITY_PUSH_GATEWAY_IOS_APP_ID) {
    return 'ios';
  }
  return undefined;
}

function deliveryFor(
  clientInstallation: unknown,
  notification: ParsedNotification,
  env: ConfigurationEnvironment,
): FcmDelivery | undefined {
  const result = z.safeParse(CLIENT_INSTALLATION_SCHEMA, clientInstallation);
  if (!result.success) {
    return undefined;
  }
  const parsedClientInstallation = result.data;
  const platform = platformFor(parsedClientInstallation.app_id, env);
  if (platform === undefined) {
    return undefined;
  }
  const tweaks = isRecord(parsedClientInstallation.tweaks)
    ? parsedClientInstallation.tweaks
    : {};
  const deliveryBase = {
    accountRoute: parsedClientInstallation.data.trinity_account_id,
    ...(typeof tweaks.highlight === 'boolean'
      ? { highlight: tweaks.highlight }
      : {}),
    missedCalls: notification.missedCalls,
    platform,
    priority:
      notification.eventId === undefined ? 'low' : notification.priority,
    pushKey: parsedClientInstallation.pushkey,
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
    clientEmail: env.TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL,
    fetch,
    now,
    privateKey: env.TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY,
    projectId: env.TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID,
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
  metrics: GatewayMetricsSink | undefined,
  now: () => number,
  deadlineMs: number,
): Promise<ProcessedOutcome> {
  const { clientInstallation, delivery } = entry;
  const nowSeconds = Math.floor(now() / 1000);
  const claim =
    delivery.kind === 'event'
      ? await env.store.claimDelivery(
          {
            accountRoute: delivery.accountRoute,
            appId: String(clientInstallation.app_id),
            eventId: delivery.eventId,
            pushKey: delivery.pushKey,
          },
          env.TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY,
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

  const attemptStartedAt = now();
  const outcome = await fcmClient.send(delivery, deadlineMs);
  try {
    metrics?.recordFcmAttempt(
      delivery.platform,
      outcome.kind === 'delivered'
        ? 'accepted'
        : outcome.kind === 'rejected'
          ? 'permanentlyRejected'
          : 'transientFailure',
      Math.max(0, now() - attemptStartedAt),
      attemptStartedAt,
    );
  } catch {
    // Observability is deliberately best effort on the notification hot path.
  }
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
      const requestStartedAt = dependencies.now();
      const url = new URL(request.url);
      const config = runtimeConfig(env);
      let requestMetricRecorded = false;
      const recordRequest = (
        outcome: Parameters<GatewayMetricsSink['recordRequest']>[0],
      ): void => {
        if (requestMetricRecorded) {
          return;
        }
        requestMetricRecorded = true;
        try {
          dependencies.metrics?.recordRequest(outcome, requestStartedAt);
        } catch {
          // Metrics must never alter a Matrix response.
        }
      };

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
        recordRequest('invalid');
        return matrixError(405, 'M_UNRECOGNIZED', 'Method not allowed.');
      }

      if (url.pathname !== NOTIFY_PATH) {
        return matrixError(404, 'M_UNRECOGNIZED', 'Unrecognized request.');
      }

      if (config === undefined) {
        recordRequest('storageUnavailable');
        return matrixError(503, 'M_UNKNOWN', 'Gateway is not configured.');
      }

      const deadlineMs =
        requestStartedAt + config.requestDeadlineSeconds * 1000;
      const abortController = new AbortController();
      const response = await responseBeforeDeadline(
        async () => {
          const sourceLimit = await env.limiter.limit(env.sourceKey(request));
          if (!sourceLimit.success) {
            recordRequest('rateLimited');
            return rateLimitResponse(
              'Source rate limit exceeded.',
              sourceLimit.retryAfterSeconds * 1000,
            );
          }

          const jsonBody = await readJsonBody(
            request,
            config.maxBodyBytes,
            abortController.signal,
          );
          if (jsonBody.kind === 'too-large') {
            recordRequest('invalid');
            return matrixError(
              413,
              'M_TOO_LARGE',
              'Request body is too large.',
            );
          }
          if (jsonBody.kind === 'invalid') {
            recordRequest('invalid');
            return matrixError(
              400,
              'M_NOT_JSON',
              'Request body must be valid JSON.',
            );
          }

          const notification = parseNotification(jsonBody.value);
          if (notification === undefined) {
            recordRequest('invalid');
            return matrixError(
              400,
              'M_BAD_JSON',
              'Invalid Matrix notification request.',
            );
          }
          if (notification.devices.length > config.maxDevices) {
            recordRequest('invalid');
            return matrixError(
              413,
              'M_TOO_LARGE',
              'Too many client installations.',
            );
          }

          const rejected: string[] = [];
          const deliveries: DeliveryEntry[] = [];
          for (const clientInstallation of notification.devices) {
            const delivery = deliveryFor(clientInstallation, notification, env);
            if (delivery === undefined) {
              if (
                isRecord(clientInstallation) &&
                typeof clientInstallation.pushkey === 'string'
              ) {
                rejected.push(clientInstallation.pushkey);
              }
            } else if (isRecord(clientInstallation)) {
              deliveries.push({ clientInstallation, delivery });
            }
          }
          const now = requestStartedAt;
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
            recordRequest('safetyBudgetExhausted');
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
              deadlineMs
            ) {
              logOutcome(delivered, deliveries.length - offset);
              recordRequest('processed');
              return matrixError(
                502,
                'M_UNKNOWN',
                'Push provider temporarily unavailable.',
              );
            }
            const wave = deliveries.slice(offset, offset + 6);
            const outcomes = await Promise.all(
              wave.map((entry) =>
                processDelivery(
                  entry,
                  env,
                  config,
                  fcmClient,
                  dependencies.metrics,
                  dependencies.now,
                  deadlineMs,
                ),
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
              recordRequest('processed');
              return retryResponse;
            }
          }

          logOutcome(delivered, retryable);
          recordRequest('processed');
          return Response.json(
            { rejected },
            { headers: JSON_HEADERS, status: 200 },
          );
        },
        deadlineMs,
        dependencies.now,
        () => {
          abortController.abort();
        },
      );
      recordRequest('processed');
      return response;
    },
    async cleanup(env, now): Promise<void> {
      const nowSeconds = Math.floor(now / 1000);
      const utcDate = new Date(now).toISOString().slice(0, 10);
      await env.store.cleanup(nowSeconds, utcDate);
    },
  };
}
