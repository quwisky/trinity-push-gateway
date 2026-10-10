import type { Context } from 'hono';
import { createGoogleTokenSource } from '../auth/google';
import { ConfigError, parseConfig } from '../config';
import { errorResponse } from '../errors';
import { logDelivery } from '../log';
import { buildFcmMessage } from '../payload';
import { sendFcm, type Outcome, type SendResult } from '../providers/fcm';
import { allowPushkey } from '../ratelimit';
import { MAX_BODY_BYTES, parseNotify } from './parse';
import { readTextWithLimit } from './read-body';

const UPSTREAM_ERROR = 'Push delivery failed upstream, retry later';

// An unknown app ID is client-controlled, so only a bounded prefix is logged.
const MAX_LOGGED_APP_ID = 128;

function loggableUnknownAppId(appId: string): string {
  return appId.length > MAX_LOGGED_APP_ID
    ? `${appId.slice(0, MAX_LOGGED_APP_ID)}\u2026`
    : appId;
}

export async function handleNotify(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const declared = Number(c.req.header('content-length'));
  if (declared > MAX_BODY_BYTES) {
    return errorResponse(413, 'M_TOO_LARGE', 'request body too large');
  }

  const raw = await readTextWithLimit(c.req.raw.body, MAX_BODY_BYTES);
  if (raw === null) {
    return errorResponse(413, 'M_TOO_LARGE', 'request body too large');
  }

  const parsed = parseNotify(raw);
  if (!parsed.ok) {
    return errorResponse(parsed.status, parsed.errcode, parsed.error);
  }
  const { notification } = parsed;

  let config;
  try {
    config = parseConfig(c.env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // ConfigError messages name the failing setting, never its value.
    console.error(
      JSON.stringify({ event: 'config_error', message: err.message }),
    );
    return errorResponse(500, 'M_UNKNOWN', 'Gateway is misconfigured');
  }

  const tokens = createGoogleTokenSource({
    serviceAccount: config.serviceAccount,
    kv: c.env.TOKENS,
  });
  const limiter = c.env.PUSHKEY_LIMITER as RateLimit | undefined;

  const results = await Promise.all(
    notification.devices.map(
      async (device): Promise<{ pushkey: string; outcome: Outcome }> => {
        const { app_id: appId, pushkey } = device;
        if (!Object.hasOwn(config.apps, appId)) {
          logDelivery({
            appId: loggableUnknownAppId(appId),
            outcome: 'unknown_app',
          });
          return { pushkey, outcome: 'rejected' };
        }
        if (!(await allowPushkey(limiter, pushkey))) {
          logDelivery({ appId, outcome: 'throttled' });
          return { pushkey, outcome: 'ok' };
        }
        const message = await buildFcmMessage(notification, device);
        if (message === null) {
          logDelivery({ appId, outcome: 'skipped' });
          return { pushkey, outcome: 'ok' };
        }
        const result: SendResult = await sendFcm(message, {
          projectId: config.serviceAccount.projectId,
          tokens,
        });
        logDelivery({ appId, ...result });
        return { pushkey, outcome: result.outcome };
      },
    ),
  );

  if (results.some((r) => r.outcome === 'retry')) {
    return errorResponse(502, 'M_UNKNOWN', UPSTREAM_ERROR);
  }
  const rejected = [
    ...new Set(
      results.filter((r) => r.outcome === 'rejected').map((r) => r.pushkey),
    ),
  ];
  return c.json({ rejected });
}
