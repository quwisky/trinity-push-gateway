# Deployment Guide

The production deployment is a Cloudflare Worker with D1, a rate-limit binding, a daily cron trigger, and a stable custom hostname. Firebase and Cloudflare credentials are operator-owned and must never be committed.

## Prerequisites

- A Cloudflare account with a managed DNS zone and Workers/D1 enabled.
- A Firebase project containing the Android and iOS apps.
- The FCM HTTP v1 API enabled.
- A dedicated Google service account restricted to sending Firebase Cloud Messaging messages for this project.
- APNs credentials configured in Firebase for the iOS app. This is infrastructure setup only; iOS client work remains a separate task.

## 1. Select the production hostname

Replace development-only routing in `wrangler.jsonc` before production:

```json
"workers_dev": false,
"routes": [
  {
    "pattern": "push.example.com",
    "custom_domain": true
  }
]
```

Use a hostname in a zone managed by the target Cloudflare account. Cloudflare creates the DNS record and certificate for a Custom Domain.

## 2. Authenticate and provision D1

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec wrangler login
pnpm exec wrangler d1 migrations apply DB --remote
```

Wrangler's automatic resource provisioning creates the configured D1 database when needed. Review and commit the resulting `database_id` change if Wrangler writes it into `wrangler.jsonc`.

## 3. Add Worker secrets

Generate `FINGERPRINT_KEY` independently; do not reuse a Firebase secret.

```sh
pnpm exec wrangler secret put FCM_CLIENT_EMAIL
pnpm exec wrangler secret put FCM_PRIVATE_KEY
pnpm exec wrangler secret put FCM_PROJECT_ID
pnpm exec wrangler secret put FINGERPRINT_KEY
```

Paste values only into Wrangler's prompt. For the private key, preserve the complete PEM including its header and footer.

## 4. Validate and deploy

```sh
pnpm check
pnpm deploy
```

Then verify:

```sh
curl --fail --show-error https://push.example.com/health
```

Expected response:

```json
{ "status": "ok", "version": "0.1.0" }
```

Do not point Matrix pushers at the production hostname until the D1 migration and readiness check both succeed.

## 5. Operate

- Inspect aggregate events in Cloudflare Workers observability. Logs deliberately exclude Push Keys, Matrix IDs, account routes, content, and credentials.
- Monitor `429`, `502`, and `503` response rates. `429` indicates source or daily safety limits; `502` is a retryable provider failure; `503` is configuration, dependency, or concurrent-delivery unavailability.
- Rotate the Google service-account key and `FINGERPRINT_KEY` through Wrangler secrets. Rotating the fingerprint key resets event retry suppression, so schedule it during a low-volume period.
- Apply future D1 migrations before deploying code that requires them.
- Use immutable `vX.Y.Z` Git tags for releases and retain the preceding Worker version for rollback.

## External smoke test

A real FCM installation token is intentionally not stored or used by CI. Once a compatible client build exists in the separate client task, send one private Matrix event to a test account and verify provider acceptance plus the client-side behavior listed in [the client contract](CLIENT-CONTRACT.md).
