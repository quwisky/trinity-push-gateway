# Trinity push gateway

A [Matrix push gateway](https://spec.matrix.org/v1.16/push-gateway-api/) for the
[Trinity Matrix client](https://github.com/quwisky/trinity-matrix-client), running as a
Cloudflare Worker on the free tier. It delivers to Android and iOS through FCM HTTP v1;
FCM relays iOS pushes to APNs. The gateway only ever sees event and room IDs, never
message content.

## Point Trinity at it

In Trinity, open Settings → Notifications → Push gateway and enter the full notify URL:

```
https://<your-worker>.workers.dev/_matrix/push/v1/notify
```

For a custom build, set `environment.push.gatewayUrl` to the same URL instead. The
default app IDs (`eu.qwky.trinity.android` and `eu.qwky.trinity.ios`) are already
allowlisted in `apps/gateway/wrangler.jsonc`.

## Deploy your own

You need a Cloudflare account, Node 24 and pnpm 12 (`pnpm install` first).

1. **Firebase.** Create a Firebase project and add your Android app and your iOS app to
   it. For iOS, upload an APNs authentication key (`.p8`) under Project settings → Cloud
   Messaging. One key covers both sandbox and production.
2. **Service account.** In Project settings → Service accounts, create a service account
   with the Firebase Cloud Messaging API Admin role and download its JSON key as
   `key.json`.
3. **KV namespace.** Create it, then put the returned ID in the `TOKENS` entry of
   `apps/gateway/wrangler.jsonc`:

   ```sh
   pnpm exec wrangler kv namespace create TOKENS
   ```

4. **App IDs.** Edit the `APPS` var in `apps/gateway/wrangler.jsonc`. It maps each
   accepted pusher app ID to its provider, and only `{ "kind": "fcm" }` exists:

   ```json
   "APPS": {
     "com.example.app.android": { "kind": "fcm" },
     "com.example.app.ios": { "kind": "fcm" }
   }
   ```

   Pushers for any other app ID are rejected without calling FCM.

5. **Secret.** Run this from `apps/gateway`:

   ```sh
   cd apps/gateway
   pnpm exec wrangler secret put FCM_SERVICE_ACCOUNT < ../../key.json
   cd ../..
   ```

   Delete `key.json` afterwards. The service account lives only in Cloudflare.

6. **Deploy:**

   ```sh
   pnpm exec nx run gateway:deploy
   ```

7. **Smoke test** with a real FCM token from a device:

   ```sh
   pnpm smoke --url https://<your-worker>.workers.dev --app-id <app id> --pushkey <fcm token>
   ```

   It exits 1 if the gateway does not answer 200 or lists the pushkey as rejected. Add
   `--render device` to send `trinity_render: "device"`.

`GET /health` returns `200 ok` without contacting FCM.

If the deploy rejects `ratelimits` on the free plan, remove that block from
`apps/gateway/wrangler.jsonc` and add a WAF rate-limiting rule instead. The Worker runs
without the binding.

## Releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), checked by
commitlint. [release-please](https://github.com/googleapis/release-please) keeps a
release PR open on `main` with the version bump and `CHANGELOG.md`. Merging it tags
`vX.Y.Z`, publishes the GitHub release, and deploys the Worker in the same workflow run.

To enable this on a fork:

- Create a GitHub App with contents and pull-requests write access, and install it on
  the repository. Its token is what makes CI run on release PRs.
- Create a `release-app` environment holding the variable `RELEASE_APP_CLIENT_ID` and
  the secret `RELEASE_APP_PRIVATE_KEY`.
- Add the repository secrets `CLOUDFLARE_API_TOKEN` (permission to edit Workers) and
  `CLOUDFLARE_ACCOUNT_ID`.

## Free-tier ceilings

- 100,000 requests/day. Beyond that Cloudflare fails requests and homeservers retry
  later.
- 10 ms CPU per request. RSA signing is native WebCrypto and happens about once an hour
  per isolate at most.
- 50 subrequests per invocation. This bounds a request to 10 devices.
- KV: 1,000 writes/day and 100,000 reads/day. KV holds only the cached OAuth token.

Requests over 64 KB get 413, and requests with more than 10 devices get 400. Each
pushkey is limited to 60 notifications per 60 seconds; excess ones are dropped quietly.

## Client contract

The gateway expects the `event_id_only` format. Android pushkeys are FCM registration
tokens. **iOS pushkeys must be FCM tokens too**, not raw APNs device tokens: a raw APNs
token gets FCM `400 INVALID_ARGUMENT`, which is logged and dropped. To get FCM tokens
on iOS the app needs Firebase Messaging (it sets `Messaging.messaging().apnsToken` and
passes the FCM token on as the pushkey), `GoogleService-Info.plist`, and the Push
Notifications capability.

### Build variants

Stable, prerelease and TestFlight builds need nothing extra on the gateway:

- Builds with the same bundle or package ID register the same app IDs and use the same
  Firebase project.
- TestFlight and App Store builds use production APNs and Xcode debug builds use
  sandbox. The Firebase iOS SDK picks the right one, and a single `.p8` key covers both.
- `APPS` is keyed by the pusher app ID (`PushConfig.appId`), not the bundle or package
  ID. A side-by-side variant with its own package ID only needs registering as an extra
  app in the same Firebase project.

### Data keys

Every push carries these keys, all strings; absent values are omitted:

| Key               | Source                           |
| ----------------- | -------------------------------- |
| `event_id`        | `event_id`                       |
| `room_id`         | `room_id`                        |
| `trinity_user_id` | `devices[].data.trinity_user_id` |
| `unread`          | `counts.unread`                  |
| `missed_calls`    | `counts.missed_calls`            |
| `prio`            | `prio`                           |

On iOS they appear at the top level of the APNs payload.

### Render modes

The client picks a mode with `trinity_render` in the pusher's `data`. A missing or
unknown value means the default.

- **Default.** Android gets a `notification` titled "Trinity" with body "New message",
  channel `messages`, tag = room ID. iOS gets the same alert with an `apns-collapse-id`
  derived from the room ID. Either way there is one notification per room, replaced by
  newer ones.
- **`trinity_render: "device"`**, for clients that fetch and decrypt on the device.
  Android gets a data-only message the app renders itself. iOS gets the alert with no
  collapse ID and `mutable-content: 1`, so a Notification Service Extension can rewrite
  each one.

Notifications without an event (sent when a room is read) carry the data keys only on
Android, and only a badge update on iOS (`aps.badge` = unread count).

### Responses

| Outcome                                             | Gateway response                           |
| --------------------------------------------------- | ------------------------------------------ |
| Delivered, throttled, or permanently failed         | `200 {"rejected": []}`                     |
| FCM `404 UNREGISTERED`, or `403 SENDER_ID_MISMATCH` | `200 {"rejected": ["<pushkey>"]}`          |
| FCM 429, 5xx, or a network error                    | `502 M_UNKNOWN`, so the homeserver retries |
| Malformed body or more than 10 devices              | `400 M_BAD_JSON`                           |

Only dead tokens are rejected, because a rejected pushkey makes the homeserver delete
the pusher.

## Privacy

The gateway receives room and event IDs, unread counts, priority, account IDs and a
device token that links one installation's accounts. Google relays this metadata to the
device. Message content never reaches the gateway or Google.

The gateway never logs pushkeys, user IDs, room IDs or event IDs. Log lines hold only
the app ID, the FCM status and error code, and the outcome. Logs go to Workers Logs.

## Development

```sh
pnpm install
cp apps/gateway/.dev.vars.example apps/gateway/.dev.vars   # then paste your service-account JSON
pnpm exec nx run gateway:dev
pnpm test
```

Run the full gate with `pnpm exec nx format:check && pnpm exec nx run-many -t lint typecheck test build`.
After changing `wrangler.jsonc` bindings, regenerate the committed types with
`pnpm exec nx run gateway:types`.
