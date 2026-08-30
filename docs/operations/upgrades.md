# Upgrade and rollback

Stable releases use immutable `vX.Y.Z` tags. Avoid automatic container updaters;
an operator should back up, upgrade, and verify deliberately.

## Upgrade a self-hosted deployment

1. Create and retain a verified backup.
2. Pin `TRINITY_PUSH_GATEWAY_VERSION` to the new tag or image digest.
3. Run `docker compose pull` and `docker compose up --detach`.
4. Wait for `/health` and inspect redacted startup and migration logs.

Startup applies forward-only migrations before opening the HTTP listener.

## Roll back

Migrations preserve a one-version rollback path when the preceding image can
safely read the schema. To roll back, stop the new container, pin the immediately
preceding stable image, recreate it, and verify health. The gateway refuses an
incompatible newer schema and never downgrades automatically.

For Cloudflare, retain the preceding Worker release, apply D1 migrations before
dependent code, and use the same health and log checks after deployment.
