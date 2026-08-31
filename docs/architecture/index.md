# Trinity Push Gateway Design

This document records the accepted design implemented by the Trinity Push Gateway.

## Goal

Provide a small, privacy-preserving implementation of the Matrix Push Gateway API that runs either within Cloudflare Workers' free tier or as one self-hosted Bun/SQLite container and delivers notifications to compatible Android and iOS apps through Firebase Cloud Messaging HTTP v1.

The gateway is single-tenant. Each deployment serves one operator-controlled Firebase project and one Android/iOS app-ID pair. Trinity uses:

- `ovh.qwky.trinity.android`
- `ovh.qwky.trinity.ios`

It accepts notification requests from arbitrary Matrix homeservers. It does not own Matrix identities, client installation registration, Matrix sync, event retrieval, or third-party Firebase credentials. A self-hosted Bun deployment may opt in to the isolated Push Gateway UI; the Cloudflare deployment exposes no operator surface and retains the same Matrix behavior.

## Public API

- `POST /_matrix/push/v1/notify` implements the Matrix notification endpoint.
- `GET /health` reports the deployed version and configuration readiness without querying FCM or exposing configuration details.
- Unknown paths return `404 M_UNRECOGNIZED`.
- Unsupported methods return `405 M_UNRECOGNIZED`.
- All responses are UTF-8 JSON using Matrix standard error bodies where applicable.
- Browser CORS is not supported.

Invalid JSON returns `400 M_NOT_JSON`; structurally invalid input returns `400 M_BAD_JSON`; excessive bodies or device arrays return `413 M_TOO_LARGE`; gateway limits return `429 M_LIMIT_EXCEEDED`; transient upstream failures return `502 M_UNKNOWN`; unavailable gateway dependencies and in-progress duplicate attempts return `503 M_UNKNOWN`.

## Self-hosted operator surface

The Push Gateway UI is disabled by default and available only with the Bun target. When enabled, one origin serves the Angular application at `/admin/`, the versioned operator API at `/admin/api/v1/`, and fixed OIDC routes at `/admin/auth/`; canonical OpenAPI 3.1.2 defines the browser API, and CORS is not supported. A Bun-only `openid-client` module performs generic standards-based OIDC while gateway-owned policy establishes time-bounded Operator Sessions for Operator Identities, and the browser receives only an opaque host-only session cookie.

Operator Identity, Operator Session, Operator Audit Entry, aggregate metrics, and operation state live in `/data/admin.sqlite`, separate from the delivery-critical gateway database. The operator API exposes bounded observation and Operator Actions for Firebase validation, cleanup, and verified gateway-database backup rather than general identity, configuration, secret, database, filesystem, or process management.

UI, OIDC, administration-database, and metrics failures cannot alter or delay Matrix notification delivery or public `/health`. Metrics are fixed-cardinality aggregates flushed best-effort by one bounded Bun Worker; that worker never owns delivery coordination.

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

FCM OAuth tokens are minted with `jose` on native Web Crypto from Worker secrets, cached only in isolate memory, refreshed early, and protected against concurrent refreshes. FCM calls run in waves of no more than six simultaneous connections.

The runtime's Gateway Store coordinates event delivery with an HMAC-SHA-256 fingerprint of app ID, Account Route, event ID, and Push Key. Cloudflare uses D1; Bun uses one local durable SQLite database. Raw identifiers are never stored.

1. Atomically claim a two-minute pending lease.
2. Return a retryable response to concurrent attempts.
3. Send through FCM.
4. Record delivered or rejected terminal state for 24 hours.
5. Allow an expired pending lease to be reclaimed.
6. Remove expired records with daily scheduled cleanup.

Both adapters implement one behavioral storage contract. Bun applies the canonical migrations before listening and uses strict bindings, WAL, full synchronous durability, foreign keys, and a finite busy timeout. Its supported topology is one service instance and one local persistent volume; horizontal replicas and network-hosted SQLite files are excluded.

This suppresses ordinary retries while preferring a rare duplicate over silent loss in the unavoidable crash window between FCM acceptance and recording the result. The service does not claim exactly-once delivery.

For mixed outcomes, `200 {"rejected": [...]}` is returned only after every installation has a terminal outcome. `UNREGISTERED` and explicitly token-specific `INVALID_ARGUMENT` results reject a Push Key. Quota, availability, internal, authentication, APNs credential, ambiguous invalid-argument, and network failures remain retryable. Both delay-seconds and HTTP-date `Retry-After` guidance are preserved. The gateway does not retry FCM within the same invocation.

## Safety envelope

- Best-effort source limit: 300 requests per source IP per 10 seconds. Cloudflare uses its binding; Bun uses a restart-local bounded in-memory limiter.
- Authoritative global limit: 20,000 delivery candidates per UTC day. Conservative accounting may include an event retry that D1 subsequently suppresses.
- Limits are configurable but must never default to unlimited behavior.
- Limits are checked before delivery state is claimed or FCM is contacted.
- Cloudflare free-tier exhaustion and self-hosted resource failures produce explicit failures rather than acknowledged drops.

## Security and observability

The public endpoint has no homeserver authentication because arbitrary Matrix homeservers must be supported. Protection comes from exact routing, bounded validation, known app IDs, rate controls, a global safety budget, minimal FCM payloads, and secret isolation.

Cloudflare uses built-in observability; Bun emits structured JSON to stdout/stderr. Logs may contain a random correlation ID, aggregate counts, coarse latency, platform, configured app ID, and outcome category. They must never contain notification content, Push Keys, access tokens, service-account material, room IDs, event IDs, sender identities, Account Routes, or Matrix user IDs.

## Implementation and repository

The standalone repository is `https://github.com/quwisky/trinity-push-gateway`. Its default branch is `master`. Nx 23 orchestrates a root-managed pnpm workspace: `apps/push-gateway` contains the Worker and Bun gateway runtime, `docs/` is the publishable `push-gateway-docs` project, and `apps/push-gateway-ui` is the isolated Angular application boundary. The UI and Bun operator surface ship in the existing gateway image and stable release, while Worker and Bun delivery adapters remain within one gateway project because they implement one Push Gateway contract. Official Nx plugins infer project-scoped ESLint and run-mode Vitest targets; Nx Core keeps explicit targets for Wrangler, Bun, VitePress, TypeScript, migration, coverage, bundle-policy, and aggregate work. Deterministic validation and filesystem outputs use the local cache, while affected-only CI preserves required check names and skips unrelated gateway and container work. Nx Cloud, Nx Release, and speculative internal libraries remain deferred.

The implementation uses one runtime-neutral request core with narrow storage and limiter ports. Cloudflare composes the module Worker, D1, rate-limit binding, and cron adapters; the self-hosted target composes Bun 1.4, built-in SQLite, an in-memory limiter, internal cleanup scheduling, and a Bun-only `openid-client` protocol module for the optional operator surface. Both use direct `fetch`, native Web Crypto, `jose` for service-account JWT signing, and Zod for untrusted-boundary validation. The runtime-specific D1 and Bun storage adapters use Drizzle for typed queries while retaining reviewed SQL for exact transaction, migration, and runtime behavior. Runtime dependencies are exactly pinned and allowlisted; Better Auth, Firebase Admin, Google Auth, retry libraries, general cross-runtime database abstractions, and external logging SDKs remain excluded. Development uses pnpm 11, Node 24, strict TypeScript, Vitest, Bun's test runner for runtime integration, ESLint, Prettier, Wrangler, Commitlint, Husky, lint-staged, Dependabot, Docker, and GitHub Actions with immutable action pins.

Cloudflare resources and configuration are managed through the app-owned Wrangler configuration. All external runtime settings and secrets share the `TRINITY_PUSH_GATEWAY_` namespace across Worker and Bun, and Cloudflare exposes the `TRINITY_PUSH_GATEWAY_DB` and `TRINITY_PUSH_GATEWAY_SOURCE_RATE_LIMITER` bindings. Self-hosting uses a hardened non-root, read-only container with a local `/data` volume, Docker secret files, external TLS termination, explicit proxy trust, startup migrations, graceful shutdown, health probing, and a verified backup command. Firebase project setup, platform registration, APNs credentials, and least-privilege service-account creation remain documented operator steps. Secrets are injected at runtime and never stored in Git.

The project uses Apache-2.0 and semantic versions. Release Please derives versions from Conventional Commits and maintains one reviewable release pull request; only squash-merging that pull request updates the generated changelog and package version and creates an immutable `vX.Y.Z` tag plus GitHub Release. That stable release publishes attested AMD64 and ARM64 Bun images to GitHub Container Registry. npm publication, prerelease channels, automatic Worker deployment, and automatic container updates are excluded. Production uses a stable TLS hostname; `workers.dev` is development-only.

## Companion client handoff

Mobile-client development is explicitly outside this repository and implementation task. A separate Trinity client task must:

1. Update both clients to register the version-one pusher contract and opaque Account Route.
2. Update iOS to register an FCM token and add Firebase Messaging, background capability, and a Notification Service Extension.
3. Add Trinity-controlled private notification handling to Android.
4. Release the clients so they replace rejected legacy pushers.

## Verification and completion

Automated coverage includes validation, payload mapping, OAuth signing, FCM error classification, redaction, shared D1/SQLite storage behavior, Matrix contract fixtures, multi-account behavior, mixed outcomes, concurrent duplicates, proxy address handling, limiter bounds, migrations, persistence, backup integrity, Bun HTTP lifecycle, Cloudflare Free-plan bundle limits, container size and health, the exact runtime dependency allowlist, and executable Nx project targets. External services are mocked in CI.

Gateway completion additionally requires a deployed-Worker smoke test when credentials and a target FCM installation are available, plus a documented client contract and handoff checklist for the separate mobile task. Real-device notification presentation, tapping, account routing, and badge behavior are deferred to that task. Documentation is updated before final validation; `CHANGELOG.md` is generated only by the release pull request. No credentials or proof artifacts enter version control.
