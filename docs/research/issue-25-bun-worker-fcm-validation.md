# Issue 25: Bun metrics Worker and Firebase validation

## Decision

Ship the metrics writer as a second, explicit Bun bundle entry point and copy
the complete Bun output directory into the runtime image. Reference its emitted
`.js` name from both source and production, attach `error` and `close` handlers
before posting work, and use `ref: false` plus a bounded cooperative shutdown.
Worker loss disables metrics collection and drops subsequent increments; it
must not affect the notification path.

Validate Firebase with one direct HTTP v1 request whose JSON body has the
top-level `validate_only: true` flag and a fixed, deliberately invalid target.
Treat only a successful response or an FCM-specific invalid-target response as
proof that the configured credentials could access the configured project's FCM
API. Report it strictly as credential/project/API access, never as an end-to-end
delivery result.

## Bun 1.4 Worker and bundle contract

Bun's `Worker` is an experimental server-side Web Worker implementation. A
worker may use ES modules without `{ type: "module" }`; Bun's 1.4 declarations
state that the `type` option does nothing
([Bun 1.4 Worker options](https://github.com/oven-sh/bun/blob/bun-v1.4.0/packages/bun-types/bun.d.ts#L393-L397)).
Bun emits `open` when the worker is ready, queues messages sent before `open`,
and emits `error` when the entry module cannot resolve
([Bun 1.4 Worker creation](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/runtime/workers.mdx#L13-L59),
[open semantics](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/runtime/workers.mdx#L99-L111)).
The same page defines the relevant lifecycle behavior:

- a worker remains alive while its event loop has work, including a global
  `message` listener;
- `terminate()` requests exit as soon as possible;
- `close` is emitted when Bun has marked the worker terminated, before full
  teardown is necessarily complete, and carries the worker exit code;
- `process.exit()` in the worker exits only that worker; and
- `ref: false`/`unref()` prevents the worker from keeping the parent process
  alive.

Those lifecycle details are in the tagged
[termination](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/runtime/workers.mdx#L196-L225)
and
[reference-management](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/runtime/workers.mdx#L227-L259)
documentation. Use `ref: false` explicitly: Bun 1.4's prose and type annotation
disagree about the default, so relying on it would make shutdown behavior
ambiguous.

For bundling, Bun generates one output for every explicit entry point
([Bun 1.4 entry-point contract](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/bundler/index.mdx#L199-L219)). It
does not document ordinary `bun build` as discovering a `new Worker(...)`
target. Its standalone-executable guidance is explicit that the worker must be
added as another build entry point
([Bun 1.4 Worker executable guidance](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/bundler/executables.mdx#L601-L638)).

An exact local probe with the repository-pinned Bun 1.4.0 confirmed the same
constraint for the current non-compiled build:

1. Building only `main.ts`, where the main module constructs
   `new Worker(new URL("./worker.ts", import.meta.url).href)`, emitted only
   `main.js`; the metafile contained no worker input or output.
2. Building `main.ts worker.ts` emitted `main.js` and `worker.js`, but did not
   rewrite the literal `./worker.ts` in `main.js`. Running the bundle therefore
   emitted `error` and then `close` with exit code 1 because `worker.ts` was not
   present.
3. Running the source modules directly delivered the queued message, and
   `terminate()` produced `close` with exit code 0. A deliberately throwing
   worker produced `error` followed by `close` with exit code 1 while the
   handled failure did not terminate the parent.
4. Changing the constructor URL to `./worker.js` while retaining `worker.ts`
   made both the direct source run and the two-entry production bundle deliver
   the message and close with exit code 0.

### Implementation consequences

- Add the metrics module as a second entry point in both the Nx Bun build and
  Docker build. Do not expect the constructor expression to make it reachable.
  Set `--root src/bun` so the default `[dir]/[name].[ext]` entry naming produces
  a deliberate, stable relative layout
  ([Bun 1.4 root and naming](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/bundler/index.mdx#L935-L980)).
- Construct it as:

  ```ts
  new Worker(new URL('./metrics-writer.worker.js', import.meta.url).href, {
    name: 'metrics-writer',
    ref: false,
  });
  ```

  Keep the source module as
  `metrics-writer.worker.ts`. Bun substitutes `.js` with the matching `.ts`
  module when the JavaScript file is absent during source execution
  ([Bun 1.4 module substitution](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/runtime/module-resolution.mdx#L62-L75));
  the literal `.js` then matches the emitted production entry point.

- Copy the whole Bun bundle directory into the runtime image, not only
  `main.js`. This includes the worker and remains correct if code splitting is
  enabled later. Bun currently defaults splitting to `false`
  ([Bun 1.4 splitting contract](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/bundler/index.mdx#L425-L484)).
- Gate the bundle with its metafile and a production-artifact smoke test: the
  worker entry must appear as both an input and an output, and the copied
  runtime layout must reach `open` or complete one test flush without an
  `error`/non-zero `close`
  ([Bun 1.4 metafile contract](https://github.com/oven-sh/bun/blob/bun-v1.4.0/docs/bundler/index.mdx#L1335-L1428)).
- Register lifecycle listeners before posting the first message. On `error` or
  unexpected `close`, atomically mark the producer dead and replace it with a
  no-op drop sink. Retain only a sanitized `event.message`: Bun's tagged test
  permits an uncaught worker failure's `event.error` to be `null`
  ([Bun 1.4 error test](https://github.com/oven-sh/bun/blob/bun-v1.4.0/test/js/web/workers/worker.test.ts#L364-L371)).
  Do not use `postMessage()` as a liveness check because it is a silent no-op
  after termination
  ([Bun 1.4 termination test](https://github.com/oven-sh/bun/blob/bun-v1.4.0/test/js/web/workers/worker.test.ts#L398-L405)).
  Do not synchronously restart, wait for, or back-pressure Notification
  Requests. At service shutdown, request a cooperative stop/ack with a short
  bound, then call `terminate()` only as the fallback; `terminate()` returns
  `void` and `close` does not prove full teardown is already complete.

## FCM HTTP v1 `validate_only` contract

The send method is:

```text
POST https://fcm.googleapis.com/v1/projects/{project-id}/messages:send
```

Its request schema places `validate_only` at the top level, as a sibling of the
required `message` object—not inside `message`
([FCM send reference](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send)):

```json
{
  "validate_only": true,
  "message": {
    "token": "trinity-push-gateway-validation-only"
  }
}
```

The reference defines `validate_only` as testing the request without actually
delivering it. Firebase's Admin SDK describes the corresponding dry-run mode as
performing SDK and backend validation and emulating the send without delivery
([Firebase Admin Go implementation](https://github.com/firebase/firebase-admin-go/blob/eebb06f2a643fbb59b1cb262874a943584475128/messaging/messaging.go#L973-L986)).
Only one message target is required; other payload fields are optional, so the
minimal target-only message avoids unrelated platform or payload validation
([FCM Message schema](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages#resource:-message)).

The call must use an OAuth access token with the
`https://www.googleapis.com/auth/firebase.messaging` scope and the token must be
sent as `Authorization: Bearer ...`. The configured project identifier belongs
in the endpoint, and the calling service account needs permission in that
target project
([FCM HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/send/v1-api#authorize-http-v1-send-requests)).

The current REST reference marks `message.token` deprecated in favor of `fid`
while explicitly retaining token/FID compatibility during the transition. This
ticket's probe can still use the registration-token field required by its
accepted contract; it must not silently migrate the delivery contract.

### Result classification

Use a fixed sentinel that is deliberately not an actual Push Key. It is not a
secret and must never be replaced with a Client Installation's real token.
Interpret the result narrowly:

| Response                                                                      | Validation result                                                                                                                                                       |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2xx`                                                                         | Access succeeded; no delivery occurred because `validate_only` was true. A success for the deliberately invalid sentinel is unexpected but still not a delivery result. |
| FCM-specific `INVALID_ARGUMENT` for the registration token, or `UNREGISTERED` | Access succeeded. OAuth minting, the configured project route, authorization, and FCM request processing completed far enough for FCM to classify the synthetic target. |
| `google.rpc.BadRequest` field violation                                       | Failed validation request; do not confuse a malformed payload with the expected invalid-target result.                                                                  |
| OAuth failure, `401`, `403`, or other project/permission response             | Credential, project, API-enable, or permission validation failed.                                                                                                       |
| Timeout, network failure, `429`, or `5xx`                                     | Access could not be established now; report a coarse unavailable/failed reason, not credential success.                                                                 |

FCM's official error example distinguishes an invalid registration token by the
`details[].@type` value
`type.googleapis.com/google.firebase.fcm.v1.FcmError` and its `errorCode`, while
a malformed request uses `google.rpc.BadRequest`
([FCM HTTP v1 error format](https://firebase.google.com/docs/cloud-messaging/error-codes#rest_error_codes_for_the_http_v1_api)).
Inspect those structured fields rather than response text. The same source
documents `UNREGISTERED` as HTTP 404 and explains that `INVALID_ARGUMENT` can
also mean a malformed message; the FCM-specific detail and deliberately minimal
payload are therefore essential.

Treating the exact FCM-specific invalid-target response as access success is an
operational inference from reaching FCM's documented target-classification
path instead of receiving an OAuth, project, API-enable, or permission error.
The public API documentation does not promise the backend's internal validation
order. Keep the surfaced claim narrow and retain contract tests for every
response class.

This probe establishes only that the configured service-account credential can
mint a scoped token and reach the configured project's enabled/authorized FCM
send API. It does not test an actual app registration, Sender ID ownership,
APNs setup, FCM handoff to a Client Installation, notification rendering, or
device delivery. Those claims require a real installation and are explicitly
outside this safe operator action.
