# Self-hosting with Bun, SQLite, and Docker

The supported self-hosted topology is one Linux container and one SQLite database on local persistent storage. The same Matrix and FCM contract runs on Cloudflare Workers and Bun; horizontal replicas, network filesystems, built-in TLS, outbound proxies, custom certificate authorities, and client development are outside this deployment.

## Prerequisites

- Docker Engine with Docker Compose.
- AMD64 or ARM64 Linux.
- A Firebase project and compatible Android and iOS app IDs controlled by the Gateway Operator.
- Direct CA-validated HTTPS access to Google OAuth and FCM.
- A TLS reverse proxy on the host or the same private Docker network.

Production deployments should pin `TRINITY_PUSH_GATEWAY_VERSION` to an immutable `vX.Y.Z` tag or image digest. `latest` is a quick-start convenience, not an upgrade policy.

## Configure secrets

Copy `.env.self-host.example` to an ignored environment file and set both app IDs. Create an operator-protected `secrets` directory containing four non-empty files:

- `fcm_client_email`
- `fcm_private_key`, containing the complete PEM
- `fcm_project_id`
- `fingerprint_key`, containing an independent value of at least 32 bytes

The supplied Compose service mounts these values through Docker secrets and starts Bun with automatic `.env` loading disabled. Direct `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, and `FINGERPRINT_KEY` values remain available for controlled development. Setting a direct value and its `_FILE` alternative together is an error.

## Start and verify

```sh
docker compose --env-file .env.self-host up --detach --build
curl --fail --show-error http://127.0.0.1:3000/health
```

The image runs as UID/GID 1000 with a read-only root filesystem. The named `gateway-data` volume is the only persistent writable location. Operators replacing it with a bind mount must prepare that directory for UID/GID 1000 before startup.

Expected health response:

```json
{ "status": "ok", "version": "<current package version>" }
```

Health validates configuration, storage access, and the current schema without contacting FCM or exposing internal details. Startup applies forward-only migrations and exits on migration, schema, or integrity failure before opening the HTTP listener.

## TLS and source addresses

Compose binds plain HTTP to `127.0.0.1:3000`; place Caddy, nginx, Traefik, or an equivalent TLS proxy in front of it. The proxy must replace untrusted forwarded-address input.

For a host proxy, a minimal Caddy route is:

```caddyfile
push.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

For nginx, replace rather than append the client header:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

For Traefik or another proxy on the same Docker network, remove the host `ports` mapping, expose port 3000 only to that network, and configure the proxy's trusted forwarded-header networks.

By default the gateway rate-limits the direct peer. To use a forwarded address, set every direct proxy network in `TRUSTED_PROXY_CIDRS` and choose `CLIENT_IP_HEADER=x-forwarded-for` or `cf-connecting-ip`. Invalid, ambiguous, or entirely trusted chains share the fail-closed `unknown-source` key.

## Runtime configuration

The Bun deployment defaults to:

| Setting                      |                Default |
| ---------------------------- | ---------------------: |
| `HOST`                       |              `0.0.0.0` |
| `PORT`                       |                 `3000` |
| `DATABASE_PATH`              | `/data/gateway.sqlite` |
| `MAX_BODY_BYTES`             |                `65536` |
| `MAX_DEVICES`                |                   `49` |
| `MAX_DAILY_ATTEMPTS`         |                `20000` |
| `PENDING_LEASE_SECONDS`      |                  `120` |
| `TERMINAL_RETENTION_SECONDS` |                `86400` |
| `UPSTREAM_TIMEOUT_SECONDS`   |                   `10` |
| `REQUEST_DEADLINE_SECONDS`   |                   `30` |
| `SOURCE_RATE_LIMIT`          |                  `300` |
| `SOURCE_RATE_PERIOD_SECONDS` |                   `10` |
| `MAX_SOURCE_KEYS`            |                `10000` |
| `CLEANUP_INTERVAL_SECONDS`   |                `86400` |

The short source limiter is process-local and may reset on restart. The SQLite daily budget remains authoritative. SQLite uses strict bindings, WAL, full synchronous durability, foreign keys, and a five-second busy timeout. Keep the database, `-wal`, and `-shm` files together on local storage.

## Backup and restore

Create a consistent online snapshot in a new file:

```sh
docker compose --env-file .env.self-host run --rm \
  --volume "$PWD/backups:/backups" \
  gateway backup "/backups/gateway-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

Prepare the host backup directory for UID/GID 1000 and copy verified snapshots off-host. The command refuses to overwrite a file and verifies SQLite integrity before reporting success.

For an offline restore, stop the gateway, preserve the current volume, replace the database only from a verified snapshot, remove stale WAL and shared-memory files, and restart. `/health` must become ready before Matrix pushers resume traffic. Never copy only the main file from a live WAL database.

## Upgrade and rollback

1. Create and retain a verified backup.
2. Pin the new `vX.Y.Z` image or digest.
3. Run `docker compose pull` and `docker compose up --detach`.
4. Wait for healthy status and inspect redacted startup/migration logs.

Migrations are expand-first and preserve a one-version rollback path. To roll back, stop the new container, pin the immediately preceding stable image, recreate it, and verify health. The gateway refuses unknown newer schemas and never downgrades automatically.

## Operations and troubleshooting

- Structured JSON logs go to stdout/stderr. They exclude Push Keys, Matrix identifiers, account routes, payloads, access tokens, and credentials.
- `429` means the short source limit or persistent daily budget was exhausted.
- `502` means OAuth or FCM was unavailable or timed out.
- `503` means configuration, storage, schema, or concurrent delivery was unavailable.
- A full disk, SQLite busy timeout, I/O error, or runtime storage failure fails requests explicitly; the gateway never bypasses delivery coordination or budgets.
- Rotate configuration and credentials by recreating the container. There is no live reload or HTTP administration endpoint.
- Do not use an automatic container updater. Back up, upgrade, and verify explicitly.
