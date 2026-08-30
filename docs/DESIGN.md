# Trinity Push Gateway Design

This document records the accepted design implemented by the Trinity Push Gateway.

## Goal

Provide a small, privacy-preserving implementation of the Matrix Push Gateway API that runs within Cloudflare Workers' free tier and delivers notifications to Trinity's Android and iOS apps through Firebase Cloud Messaging HTTP v1.

The gateway is single-tenant. It serves one operator-controlled Firebase project and these Matrix app IDs:

- `ovh.qwky.trinity.android`
- `ovh.qwky.trinity.ios`

It accepts notification requests from arbitrary Matrix homeservers. It does not own users, client installation registration, Matrix sync, event retrieval, an administration UI, or third-party Firebase credentials.

## Public API

- `POST /_matrix/push/v1/notify` implements the Matrix notification endpoint.
- `GET /health` reports the deployed version and configuration readiness without querying FCM or exposing configuration details.
- Unknown paths return `404 M_UNRECOGNIZED`.
- Unsupported methods return `405 M_UNRECOGNIZED`.
- All responses are UTF-8 JSON using Matrix standard error bodies where applicable.
- Browser CORS is not supported.

Invalid JSON returns `400 M_NOT_JSON`; structurally invalid input returns `400 M_BAD_JSON`; excessive bodies or device arrays return `413 M_TOO_LARGE`; gateway limits return `429 M_LIMIT_EXCEEDED`; transient upstream failures return `502 M_UNKNOWN`; unavailable gateway dependencies and in-progress duplicate attempts return `503 M_UNKNOWN`.

## Input boundary

Requests are limited to 64 KiB and 49 client installations. Known Matrix fields are strictly validated for type, size, and cross-field consistency. Unknown fields are tolerated for forward compatibility but ignored and never forwarded.

Each device must use a configured app ID and provide:

- `data.format: "event_id_only"`
- `data.trinity_push_version: "1"`
- `data.trinity_account_id`: an opaque, persistent account route created by the client installation
- an FCM Push Key

Invalid per-device configuration is reported through the Matrix `rejected` list without preventing valid devices in the same request from being processed.

## Mobile delivery contract

All FCM data values are strings. Version 1 contains only:

- `schema`: `"1"`
- `kind`: `"event"` or `"counts"`
- `trinity_account_id`
- `event_id` and `room_id` for an event notification
- `unread` and `missed_calls`, defaulting to `"0"`
- `highlight` when the Matrix tweak is present
- `sound`: `"true"` or `"false"`

The gateway never forwards event content, sender details, room names, aliases, Matrix user IDs, arbitrary pusher data, arbitrary sound names, or raw app IDs.

Android receives data-only messages and renders notifications after syncing and decrypting. iOS receives a localized generic fallback with unread badge state; a Notification Service Extension may replace it after syncing and decrypting. Both platforms use only their default notification sound when Matrix requests sound.

Event notifications have a one-hour provider TTL and do not collapse. Count-only updates are silent, normal priority, have a one-hour TTL, collapse per Account Route, and treat omitted counts as zero.

## Delivery processing

FCM OAuth tokens are minted with native Web Crypto from Worker secrets, cached only in isolate memory, refreshed early, and protected against concurrent refreshes. FCM calls run in waves of no more than six simultaneous connections.

D1 coordinates event delivery with an HMAC-SHA-256 fingerprint of app ID, Account Route, event ID, and Push Key. Raw identifiers are never stored.

1. Atomically claim a two-minute pending lease.
2. Return a retryable response to concurrent attempts.
3. Send through FCM.
4. Record delivered or rejected terminal state for 24 hours.
5. Allow an expired pending lease to be reclaimed.
6. Remove expired records with daily scheduled cleanup.

This suppresses ordinary retries while preferring a rare duplicate over silent loss in the unavoidable crash window between FCM acceptance and recording the result. The service does not claim exactly-once delivery.

For mixed outcomes, `200 {"rejected": [...]}` is returned only after every installation has a terminal outcome. `UNREGISTERED` and explicitly token-specific `INVALID_ARGUMENT` results reject a Push Key. Quota, availability, internal, authentication, APNs credential, ambiguous invalid-argument, and network failures remain retryable. The gateway does not retry FCM within the same invocation.

## Free-tier protection

- Best-effort source limit: 300 requests per source IP per 10 seconds.
- Authoritative global limit: 20,000 delivery candidates per UTC day. Conservative accounting may include an event retry that D1 subsequently suppresses.
- Limits are configurable but must never default to unlimited behavior.
- Limits are checked before delivery state is claimed or FCM is contacted.
- Free-tier exhaustion produces explicit failures rather than acknowledged drops.

## Security and observability

The public endpoint has no homeserver authentication because arbitrary Matrix homeservers must be supported. Protection comes from exact routing, bounded validation, known app IDs, rate controls, a global safety budget, minimal FCM payloads, and secret isolation.

The Worker uses Cloudflare's built-in logs and observability without an external runtime service. Logs may contain a random correlation ID, aggregate counts, coarse latency, platform, configured app ID, and outcome category. They must never contain notification content, Push Keys, access tokens, service-account material, room IDs, event IDs, sender identities, Account Routes, or Matrix user IDs.

## Implementation and repository

The standalone repository is `https://github.com/quwisky/trinity-push-gateway`. Its initial history is created on `main` without force operations.

The implementation uses pnpm 11, Node 24, strict TypeScript, Cloudflare's module Worker format, direct `fetch`, native Web Crypto, D1 bindings, and manual boundary validation. It has no runtime dependencies. Development uses Vitest, ESLint, Prettier, Wrangler, Conventional Commits, Keep a Changelog, and GitHub Actions with immutable action pins.

Cloudflare resources and configuration are managed through Wrangler. Firebase project setup, platform registration, APNs credentials, and least-privilege service-account creation remain documented operator steps. Secrets are injected interactively and never stored in Git.

The project uses Apache-2.0, semantic versions, an `Unreleased` changelog section, and immutable `vX.Y.Z` tags. Production uses a stable custom hostname on a Cloudflare-managed domain; `workers.dev` is development-only.

## Companion client handoff

Mobile-client development is explicitly outside this repository and implementation task. A separate Trinity client task must:

1. Update both clients to register the version-one pusher contract and opaque Account Route.
2. Update iOS to register an FCM token and add Firebase Messaging, background capability, and a Notification Service Extension.
3. Add Trinity-controlled private notification handling to Android.
4. Release the clients so they replace rejected legacy pushers.

## Verification and completion

Automated coverage includes validation, payload mapping, OAuth signing, FCM error classification, redaction, D1 integration, Matrix contract fixtures, multi-account behavior, mixed outcomes, concurrent duplicates, build size, and zero runtime dependencies. External services are mocked in CI.

Gateway completion additionally requires a deployed-Worker smoke test when credentials and a target FCM installation are available, plus a documented client contract and handoff checklist for the separate mobile task. Real-device notification presentation, tapping, account routing, and badge behavior are deferred to that task. Documentation and the changelog are updated before final validation. No credentials or proof artifacts enter version control.
