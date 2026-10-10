// Manual smoke test: POSTs one Matrix notify request to a running gateway
// (`wrangler dev` or a deployed Worker) for a real device token.
// Plain Node, no dependencies. Run it as `pnpm smoke --help`.
import { parseArgs } from 'node:util';

const NOTIFY_PATH = '/_matrix/push/v1/notify';

const USAGE = `Usage: pnpm smoke --url <gateway> --app-id <id> --pushkey <token> [--render device]

  --url       Gateway origin or full notify URL. ${NOTIFY_PATH} is appended
              when the URL does not already end with it.
  --app-id    Pusher app ID, e.g. dev.trinityproject.trinity.android.
  --pushkey   FCM registration token of the device to notify.
  --render    Set to "device" to send trinity_render: "device".
  --help      Show this text.

Exits 1 when the gateway does not answer 200 or lists the pushkey in "rejected".`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      url: { type: 'string' },
      'app-id': { type: 'string' },
      pushkey: { type: 'string' },
      render: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  }));
} catch (error) {
  fail(`${error.message}\n\n${USAGE}`);
}

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const { url, 'app-id': appId, pushkey, render } = values;
if (!url || !appId || !pushkey) {
  fail(`--url, --app-id and --pushkey are required.\n\n${USAGE}`);
}
if (render !== undefined && render !== 'device') {
  fail('--render only accepts "device".');
}

let target;
try {
  target = new URL(url);
} catch {
  fail('--url is not a valid URL.');
}
if (!target.pathname.endsWith(NOTIFY_PATH)) {
  target.pathname = target.pathname.replace(/\/+$/, '') + NOTIFY_PATH;
}

const data = { trinity_user_id: '@smoke:example.org' };
if (render) {
  data.trinity_render = render;
}

const body = {
  notification: {
    event_id: `$smoke-${Date.now()}`,
    room_id: '!smoke:example.org',
    prio: 'high',
    counts: { unread: 1 },
    devices: [{ app_id: appId, pushkey, data }],
  },
};

let response;
try {
  response = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
} catch (error) {
  fail(
    `Could not reach the gateway: ${error.cause?.code ?? error.cause?.errors?.[0]?.code ?? error.message}`,
  );
}

const text = await response.text();
console.log(`${response.status} ${response.statusText}`);
console.log(text);

let rejected = [];
try {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed?.rejected)) {
    rejected = parsed.rejected;
  }
} catch {
  // A non-JSON body is reported as-is above; the status decides.
}

if (response.status !== 200) {
  process.exit(1);
}
if (rejected.includes(pushkey)) {
  fail('The gateway rejected the pushkey: the token is unknown or dead.');
}
