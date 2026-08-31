# Upgrade and rollback

Stable releases use immutable `vX.Y.Z` tags. Avoid automatic container updaters;
an operator should back up, upgrade, and verify deliberately.

## Upgrade a self-hosted deployment

1. Create and retain a full-volume backup. A UI-created gateway snapshot does
   not protect `admin.sqlite`.
2. Pin `TRINITY_PUSH_GATEWAY_VERSION` to the new tag or image digest.
3. Run `docker compose pull` and `docker compose up --detach`.
4. Wait for `/health` and inspect redacted startup and migration logs.

Startup applies forward-only delivery migrations before opening the HTTP
listener and independently validates/applies administration migrations when
the feature is enabled. Upgrading a disabled deployment does not create
`admin.sqlite` or require administration secrets. Browser assets and the
administration API come from the same image and must never be upgraded
independently.

## Roll back

Both migration sets preserve a one-version rollback path when the preceding
image can safely read the schemas. To roll back, stop the new container, pin
the immediately preceding stable image, recreate it, and verify delivery plus
administration health and login. The gateway refuses an incompatible newer
schema and never downgrades automatically. Rollback beyond one stable version
requires restoring a compatible full-volume backup.

For Cloudflare, retain the preceding Worker release, apply D1 migrations before
dependent code, and use the same health and log checks after deployment.
