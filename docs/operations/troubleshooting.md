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

## `/admin/*` returns 404

Administration is disabled. Apply both Compose files and both environment files,
or deliberately leave it disabled. Other administration variables and secrets
are ignored in disabled mode.

## `/admin/*` returns 503 but `/health` is ready

Delivery is correctly isolated from an invalid or failed administration
subsystem. Check exact public origin and issuer values, both secret files,
`admin.sqlite` ownership/separation, administration migrations, browser assets,
and available disk space. An `admin_request_failed` event identifies one
unexpected request failure without recording the exception or request data.
Never point administration at `gateway.sqlite`.

## Login returns unavailable

Fetch the configured issuer's discovery document from the gateway host. Verify
its exact issuer, authorization/token/JWKS endpoints, client authentication
method, client secret, PKCE support, and callback URL. Check provider and gateway
clock synchronization. In the supported TLS-terminating proxy topology, keep
the configured public origin HTTPS and forward the callback path and complete
authorization-response query unchanged to Bun over HTTP. Forwarded host and
protocol headers cannot repair an incorrect public origin because the gateway
does not trust them for callback authority. Provider tokens and raw claims are
intentionally not logged.

## Login returns forbidden

Authentication succeeded but the configured group claim was missing or did not
contain the exact required group. Pocket ID requires the `groups` scope and an
allowed group assignment. Authentik requires the profile mapping and groups in
the ID token. Test a known member and non-member.

## The UI loads but a deep link or asset fails

Proxy every `/admin/*` request to the gateway without rewriting its path. Do not
configure a proxy-level SPA fallback: the gateway serves only its fixed deep
links and returns 404 for unknown routes. Hashed JS/CSS assets are immutable;
HTML is no-store. Purge any proxy rule that caches HTML as an asset.

## An Operator Action is busy or unknown

Respect the returned lease/cooldown. Do not retry `outcome_unknown`
automatically because execution may have completed before audit finalization.
Review audit outcomes, `/data/backups`, health, and redacted logs first.
