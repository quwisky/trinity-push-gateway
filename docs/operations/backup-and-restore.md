# Backup and restore

This runbook applies to the Bun and SQLite deployment. Cloudflare D1 backup and
recovery should follow the operator's Cloudflare account policy.

There are two different backup scopes. The UI action and `gateway backup`
command snapshot only the delivery database. A full-volume backup protects the
complete self-hosted deployment, including administration state.

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

## Understand the UI backup scope

The UI's **Create gateway backup** action writes a verified snapshot of
`gateway.sqlite` to `/data/backups` and records privacy-bounded metadata in
`admin.sqlite`. It does **not** include:

- `admin.sqlite`, Operator Sessions, audit entries, metrics, or operation
  leases;
- Docker secret files or environment configuration;
- the container image or reverse-proxy configuration;
- other snapshots already in `/data/backups`.

Use it for delivery-state recovery, not disaster recovery. Copy its verified
file off the gateway volume; a snapshot that exists only inside the same volume
is not an independent backup.

## Create a full-volume backup

Stop the gateway so both SQLite databases and their WAL/SHM companions are a
consistent cold set:

```sh
docker compose \
  --env-file .env.self-host \
  --env-file .env.self-host-admin \
  --file compose.yml \
  --file compose.admin.yml \
  stop gateway
```

Archive the entire `gateway-data` volume with trusted host tooling. Include
`gateway.sqlite*`, `admin.sqlite*`, and `/data/backups`; protect the archive and
its integrity digest off-host. Back up the ignored environment files, Docker
secret files, and reverse-proxy configuration separately under your secret
management policy. Do not put any of them in this repository.

## Restore the full volume

1. Keep the gateway stopped and preserve the failed volume for investigation.
2. Restore the entire archive into a new local volume with UID/GID 1000
   ownership; do not merge two database families or retain stale WAL/SHM files
   from another snapshot.
3. Restore configuration and secret files through their normal protected paths.
4. Run the new image with `gateway migrate`; it validates and migrates both
   databases when administration is enabled.
5. Start the service and require Matrix health, the administration root, OIDC
   member/non-member login, and the backup list to behave as expected.

Test this procedure regularly. A directory listing or successful archive
command is not restore evidence.
