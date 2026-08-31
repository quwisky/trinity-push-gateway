# Add an isolated self-hosted Push Gateway UI

Self-hosted deployments may opt in to a Push Gateway UI served by the Bun target from the same origin as its versioned operator API and fixed OIDC routes. It authenticates Operator Identities through generic standards-based OIDC, keeps identities, sessions, audit, metrics, and operation state in a separate `/data/admin.sqlite` database, and ships with the Bun gateway as one image and release; the operator surface remains disabled by default.

The Cloudflare Worker exposes no operator surface, and Matrix notification delivery, public `/health`, and the delivery-critical gateway database remain independent of UI, OIDC, administration-database, and metrics failures. A bounded Bun Worker is permitted only to flush best-effort aggregate metrics without delaying Matrix requests; it does not coordinate delivery.

This decision supersedes the administration-UI exclusions in ADRs 0001 and 0019 and ADR 0020's placeholder-only UI boundary. It narrows ADR 0017's worker-thread exclusion solely for the isolated metrics flush; ADR 0017's shared delivery behavior and runtime-adapter boundaries otherwise remain in force.
