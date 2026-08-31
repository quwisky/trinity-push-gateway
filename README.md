# Trinity Push Gateway

A small, privacy-preserving [Matrix Push Gateway](https://spec.matrix.org/latest/push-gateway-api/) for Trinity and compatible apps. It runs either as a Cloudflare Worker or as a self-hosted Bun/SQLite container and translates Matrix notifications into Firebase Cloud Messaging HTTP v1 requests for:

- `ovh.qwky.trinity.android`
- `ovh.qwky.trinity.ios`

The Worker has two focused runtime dependencies: `jose` for standards-conformant service-account JWT signing and Zod Mini for untrusted boundary validation. It sends event and room IDs, aggregate counts, and an opaque account route, but never forwards message content, sender identities, room names, Matrix user IDs, arbitrary pusher data, or raw sound names.

## What it provides

- `POST /_matrix/push/v1/notify`
- `GET /health`
- Android data-only delivery and iOS generic localized fallback delivery
- FCM OAuth with `jose`, native Web Crypto, and runtime-local token caching
- D1- or SQLite-backed event retry suppression with expiring leases
- Source rate limiting, a daily delivery safety budget, and six-request FCM waves
- Daily cleanup, structured redacted logs, and strict configuration readiness

This repository does not contain Trinity client development. Client registration and notification handling are defined only as a handoff in [the client contract](docs/integration/matrix.md).

## Local development

Requirements: Node 24 and Corepack. Bun 1.4.0 is additionally required for the self-hosted runtime checks.

```sh
corepack enable
pnpm install --frozen-lockfile
cp apps/push-gateway/.dev.vars.example apps/push-gateway/.dev.vars
pnpm nx run push-gateway:migrate-local
pnpm nx run push-gateway:dev
```

Replace every placeholder in `apps/push-gateway/.dev.vars`. The file is ignored by Git. Check readiness at `http://localhost:8787/health`.

Run the complete repository gate with:

```sh
pnpm nx format:check --all
pnpm nx run push-gateway:check
pnpm nx run push-gateway:check-bun
pnpm nx run push-gateway-docs:check
```

The gate reports raw and gzip bundle sizes against Cloudflare Workers Free-plan limits and rejects runtime dependencies outside the exact `jose` and Zod allowlist.

Local commits are protected by Husky: lint-staged applies the uncached Nx lint fixer and Prettier before the full typecheck and test suite, and Commitlint validates Conventional Commit messages. See [the contribution guide](CONTRIBUTING.md) for the pull-request and release contract.

## Configuration

Cloudflare non-secret limits and the two exact app IDs live in `apps/push-gateway/wrangler.jsonc`; self-hosted values use validated environment configuration. Every runtime setting uses the `TRINITY_PUSH_GATEWAY_` namespace. These four values support direct or `_FILE` configuration under Bun:

- `TRINITY_PUSH_GATEWAY_FCM_CLIENT_EMAIL`
- `TRINITY_PUSH_GATEWAY_FCM_PRIVATE_KEY`
- `TRINITY_PUSH_GATEWAY_FCM_PROJECT_ID`
- `TRINITY_PUSH_GATEWAY_FINGERPRINT_KEY`, an independent random value of at least 32 bytes

The default limits are 64 KiB per request, 49 client installations per Matrix request, 20,000 delivery candidates per UTC day, a two-minute in-progress lease, and 24-hour terminal retention. Limit configuration is fail-closed: missing or invalid values make `/health` return `503` and prevent notification processing.

## Deployment

See the [Cloudflare deployment guide](docs/deployment/cloudflare/index.md) or the [Bun/SQLite self-hosting guide](docs/deployment/self-hosting/index.md). Both production targets require a stable TLS hostname; `workers.dev` is development-only. The published user documentation is available at [quwisky.github.io/trinity-push-gateway](https://quwisky.github.io/trinity-push-gateway/).

## Releases

Successful changes on `master` create or refresh a Release Please pull request. Only squash-merging that reviewed pull request creates an immutable `vX.Y.Z` tag and GitHub Release. Releases update `package.json` and `CHANGELOG.md`, then publish attested AMD64 and ARM64 Bun images to GitHub Container Registry; they do not publish to npm or deploy the Worker.

## Design and operations

- [Accepted design](docs/architecture/index.md)
- [Domain context](CONTEXT.md)
- [Architecture decisions](docs/architecture/adr/)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)

## Workspace

Nx 23 orchestrates the root-managed pnpm workspace. Official Nx plugins infer project-scoped ESLint and run-mode Vitest targets; runtime-specific targets remain explicit, and CI runs only tasks affected by each change. The implemented backend is the `push-gateway` project under `apps/push-gateway`; `apps/push-gateway-ui` only reserves the name and location of a future Angular administration interface for self-hosted Gateway Operators. It contains no client implementation or Nx project yet.

The `push-gateway-docs` project uses the existing `docs/` tree. Run `pnpm nx run push-gateway-docs:serve` for local authoring, or `pnpm nx run push-gateway-docs:check` for its complete static-site contract.

## License

Apache-2.0. See [LICENSE](LICENSE).
