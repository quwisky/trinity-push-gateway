# Backup and restore

This runbook applies to the Bun and SQLite deployment. Cloudflare D1 backup and
recovery should follow the operator's Cloudflare account policy.

## Create a consistent snapshot

Prepare a host backup directory for UID/GID 1000, then run:

```sh
docker compose --env-file .env.self-host run --rm \
  --volume "$PWD/backups:/backups" \
  gateway backup "/backups/gateway-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

The command refuses to overwrite an existing file and verifies SQLite integrity
before reporting success. Copy verified snapshots away from the gateway host.

## Cold backup

Stop the serving container first and run the snapshot command as the only
process with the volume mounted:

```sh
docker compose --env-file .env.self-host stop gateway
docker compose --env-file .env.self-host run --rm --no-deps \
  --volume "$PWD/backups:/backups" \
  gateway backup "/backups/gateway-cold-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
```

Keep the gateway stopped until the command completes.

## Restore offline

1. Stop the gateway and preserve the current volume.
2. Replace the database only from a verified snapshot.
3. Remove stale `gateway.sqlite-wal` and `gateway.sqlite-shm` files.
4. Run `docker compose --env-file .env.self-host run --rm --no-deps gateway migrate`.
5. Restart and require `/health` to become ready before resuming traffic.

Never copy only the primary database file from a live WAL database.
