# Operate the gateway

The gateway exposes a deliberately narrow operational surface: a readiness
endpoint, structured redacted logs, explicit HTTP failures, forward-only
database migrations, and release-tagged container images.

## Routine checks

- Require `GET /health` to return HTTP 200 with `{ "status": "ok" }`.
- Alert on sustained `429`, `502`, and `503` responses.
- Monitor D1 or SQLite storage growth and the configured daily attempt budget.
- Rotate Firebase credentials and the fingerprint key through the runtime's
  secret mechanism.
- Apply database migrations before code that depends on them.

The gateway never logs push keys, Matrix identifiers, account routes, message
content, access tokens, or credentials.

## Runbooks

- [Operate and recover administration](/operations/administration)
- [Back up and restore SQLite](/operations/backup-and-restore)
- [Upgrade or roll back](/operations/upgrades)
- [Diagnose common failures](/operations/troubleshooting)
