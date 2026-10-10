import type { TokenSource } from '../auth/google';
import type { FcmMessage } from '../payload';

export type Outcome = 'ok' | 'rejected' | 'retry' | 'failed';

export interface SendResult {
  outcome: Outcome;
  /** The final HTTP status, when a response was received. */
  status?: number;
  /** The FCM error code, or `TOKEN_EXCHANGE` when no token could be obtained. */
  code?: string;
}

const FCM_ERROR_TYPE_SUFFIX = 'google.firebase.fcm.v1.FcmError';

export function fcmSendUrl(projectId: string): string {
  return `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads the FCM error code from `error.details[]` (the FcmError entry), falling
 * back to `error.status`. Tolerates any body shape, including non-JSON.
 */
function extractCode(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const { details, status } = body.error;
  if (Array.isArray(details)) {
    for (const entry of details) {
      if (
        isRecord(entry) &&
        typeof entry['@type'] === 'string' &&
        entry['@type'].endsWith(FCM_ERROR_TYPE_SUFFIX) &&
        typeof entry.errorCode === 'string'
      ) {
        return entry.errorCode;
      }
    }
  }
  return typeof status === 'string' ? status : undefined;
}

/**
 * Only definitely-dead tokens are `rejected` (the homeserver deletes the
 * pusher): 404 UNREGISTERED and 403 SENDER_ID_MISMATCH. A bare 404 or 403 is
 * most likely a misconfigured project and is `failed`.
 */
export function classifyFcmResponse(
  status: number,
  body: unknown,
): SendResult | 'auth' {
  if (status === 200) return { outcome: 'ok', status };
  if (status === 401) return 'auth';

  const code = extractCode(body);
  const withCode = (outcome: Outcome): SendResult =>
    code === undefined ? { outcome, status } : { outcome, status, code };

  if (
    (status === 404 && code === 'UNREGISTERED') ||
    (status === 403 && code === 'SENDER_ID_MISMATCH')
  ) {
    return withCode('rejected');
  }
  if (status === 429 || status >= 500) return withCode('retry');
  return withCode('failed');
}

const TOKEN_EXCHANGE_RESULT: SendResult = {
  outcome: 'retry',
  code: 'TOKEN_EXCHANGE',
};

/** Posts to FCM once. `undefined` means the request never got a response. */
async function post(
  message: FcmMessage,
  projectId: string,
  accessToken: string,
): Promise<SendResult | 'auth' | undefined> {
  try {
    const response = await fetch(fcmSendUrl(projectId), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });
    let body: unknown;
    try {
      body = JSON.parse(await response.text());
    } catch {
      body = undefined;
    }
    return classifyFcmResponse(response.status, body);
  } catch {
    return undefined;
  }
}

/** Never throws; every path returns a SendResult. */
export async function sendFcm(
  message: FcmMessage,
  opts: { projectId: string; tokens: TokenSource },
): Promise<SendResult> {
  const { projectId, tokens } = opts;

  let accessToken: string;
  try {
    accessToken = await tokens.getAccessToken();
  } catch {
    return TOKEN_EXCHANGE_RESULT;
  }

  const first = await post(message, projectId, accessToken);
  if (first === undefined) return { outcome: 'retry' };
  if (first !== 'auth') return first;

  // 401: drop the cached token and retry once. invalidate() is best-effort, so
  // the second attempt may reuse the stale token and 401 again.
  try {
    await tokens.invalidate();
  } catch {
    // best-effort
  }
  try {
    accessToken = await tokens.getAccessToken();
  } catch {
    return TOKEN_EXCHANGE_RESULT;
  }

  const second = await post(message, projectId, accessToken);
  if (second === undefined) return { outcome: 'retry' };
  if (second === 'auth') return { outcome: 'retry', status: 401 };
  return second;
}
