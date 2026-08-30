# Troubleshooting

## Health returns 503

The runtime configuration, storage connection, or schema is unavailable. Check
startup logs, required secrets, D1 bindings, SQLite volume permissions, and
pending migrations. Health deliberately does not expose the internal failure.

## Notification requests return 429

The short source rate limit or the persistent daily delivery budget was
exhausted. Confirm the traffic source before raising a limit; do not bypass
delivery coordination.

## Notification requests return 502

Google OAuth or FCM failed or timed out. Verify outbound HTTPS connectivity,
the Firebase service-account scope, project ID, and FCM API status. The response
is retryable according to the Matrix push contract.

## Notification requests return 503

Configuration, storage, schema validation, or concurrent delivery coordination
was unavailable. Check runtime health and storage before retrying.

## Self-hosted source limits group clients together

The gateway could not establish a trustworthy client address. Configure every
direct proxy network in `TRINITY_PUSH_GATEWAY_TRUSTED_PROXY_CIDRS`, select the
header your proxy replaces, and ensure untrusted clients cannot connect directly
to the container port.

## SQLite does not start

Keep the database, `-wal`, and `-shm` files together on local storage. Check
UID/GID 1000 ownership, free disk space, integrity, and migration compatibility.
Network filesystems and horizontal replicas are unsupported.
