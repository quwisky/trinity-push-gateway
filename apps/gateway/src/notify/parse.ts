import * as v from 'valibot';

export const MAX_BODY_BYTES = 65536;
export const MAX_DEVICES = 10;

export interface Device {
  app_id: string;
  pushkey: string;
  data: Readonly<Record<string, unknown>>;
}

export interface Notification {
  event_id?: string;
  room_id?: string;
  prio?: string;
  counts?: { unread?: number; missed_calls?: number };
  devices: Device[];
}

export type ParseResult =
  | { ok: true; notification: Notification }
  | {
      ok: false;
      status: 400 | 413;
      errcode: 'M_BAD_JSON' | 'M_TOO_LARGE';
      error: string;
    };

// Malformed device data must not reject the whole request: fall back to {}.
const DeviceDataSchema = v.optional(
  v.fallback(
    v.pipe(
      v.record(v.string(), v.unknown()),
      // Valibot's record accepts arrays; treat them as malformed too.
      v.rawCheck(({ dataset, addIssue }) => {
        if (dataset.typed && Array.isArray(dataset.value)) addIssue();
      }),
    ),
    {},
  ),
  {},
);

const NotifySchema = v.looseObject({
  notification: v.looseObject({
    event_id: v.optional(v.string()),
    room_id: v.optional(v.string()),
    prio: v.optional(v.string()),
    counts: v.optional(
      v.looseObject({
        unread: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
        missed_calls: v.optional(
          v.pipe(v.number(), v.integer(), v.minValue(0)),
        ),
      }),
    ),
    devices: v.pipe(
      v.array(
        v.looseObject({
          app_id: v.string(),
          pushkey: v.string(),
          data: DeviceDataSchema,
        }),
      ),
      v.maxLength(MAX_DEVICES),
    ),
  }),
});

function badJson(error: string): ParseResult {
  return { ok: false, status: 400, errcode: 'M_BAD_JSON', error };
}

/**
 * Describes where validation failed, from issue paths only. Valibot's own
 * messages can include the received value (pushkeys, Matrix IDs).
 */
function describeIssues(
  issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]],
): string {
  const paths = new Set(
    issues.map((issue) =>
      (issue.path ?? []).map((item) => String(item.key)).join('.'),
    ),
  );
  return `invalid ${[...paths].map((p) => p || 'body').join(', ')}`;
}

/** Validates the body a homeserver POSTs to /_matrix/push/v1/notify. */
export function parseNotify(raw: string): ParseResult {
  // Bytes, not UTF-16 code units: that is what the limit is about.
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      errcode: 'M_TOO_LARGE',
      error: 'request body too large',
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Not chained: the parser's message can quote part of the input.
    return badJson('body is not valid JSON');
  }

  const result = v.safeParse(NotifySchema, json);
  if (!result.success) {
    return badJson(describeIssues(result.issues));
  }
  // The schema's output is structurally a Notification; looseObject only adds
  // an index signature for the unknown fields we deliberately ignore.
  const { notification } = result.output;
  return { ok: true, notification: notification as Notification };
}
