# Trinity Push Gateway

A small, privacy-preserving [Matrix Push Gateway](https://spec.matrix.org/latest/push-gateway-api/) for Trinity and compatible apps. It runs either as a Cloudflare Worker or as a self-hosted Bun/SQLite container and translates Matrix notifications into Firebase Cloud Messaging HTTP v1 requests for:

- `ovh.qwky.trinity.android`
- `ovh.qwky.trinity.ios`

The Worker has two focused runtime dependencies: `jose` for standards-conformant service-account JWT signing and Valibot for untrusted boundary validation. It sends event and room IDs, aggregate counts, and an opaque account route, but never forwards message content, sender identities, room names, Matrix user IDs, arbitrary pusher data, or raw sound names.

## What it provides

- `POST /_matrix/push/v1/notify`
- `GET /health`
- Android data-only delivery and iOS generic localized fallback delivery
- FCM OAuth with `jose`, native Web Crypto, and runtime-local token caching
- D1- or SQLite-backed event retry suppression with expiring leases
- Source rate limiting, a daily delivery safety budget, and six-request FCM waves
- Daily cleanup, structured redacted logs, and strict configuration readiness

This repository does not contain Trinity client development. Client registration and notification handling are defined only as a handoff in [the client contract](docs/CLIENT-CONTRACT.md).

## Local development

Requirements: Node 24 and Corepack. Bun 1.4.0 is additionally required for the self-hosted runtime checks.

```sh
corepack enable
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm exec wrangler d1 migrations apply DB --local
pnpm dev
```

Replace every placeholder in `.dev.vars`. The file is ignored by Git. Check readiness at `http://localhost:8787/health`.

Run the complete repository gate with:

```sh
pnpm check
pnpm check:bun
```

The gate reports raw and gzip bundle sizes against Cloudflare Workers Free-plan limits and rejects runtime dependencies outside the exact `jose` and Valibot allowlist.

Local commits are protected by Husky: lint-staged applies ESLint and Prettier before the full typecheck and test suite, and Commitlint validates Conventional Commit messages. See [the contribution guide](CONTRIBUTING.md) for the pull-request and release contract.

## Configuration

Cloudflare non-secret limits and the two exact app IDs live in `wrangler.jsonc`; self-hosted values use validated environment configuration. These four values support direct or `_FILE` configuration under Bun:

- `FCM_CLIENT_EMAIL`
- `FCM_PRIVATE_KEY`
- `FCM_PROJECT_ID`
- `FINGERPRINT_KEY`, an independent random value of at least 32 bytes

The default limits are 64 KiB per request, 49 client installations per Matrix request, 20,000 delivery candidates per UTC day, a two-minute in-progress lease, and 24-hour terminal retention. Limit configuration is fail-closed: missing or invalid values make `/health` return `503` and prevent notification processing.

## Deployment

See the [Cloudflare deployment guide](docs/DEPLOYMENT.md) or the [Bun/SQLite self-hosting guide](docs/SELF-HOSTING.md). Both production targets require a stable TLS hostname; `workers.dev` is development-only.

## Releases

Successful changes on `master` create or refresh a Release Please pull request. Only squash-merging that reviewed pull request creates an immutable `vX.Y.Z` tag and GitHub Release. Releases update `package.json` and `CHANGELOG.md`, then publish attested AMD64 and ARM64 Bun images to GitHub Container Registry; they do not publish to npm or deploy the Worker.

## Design and operations

- [Accepted design](docs/DESIGN.md)
- [Domain context](CONTEXT.md)
- [Architecture decisions](docs/adr/)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
