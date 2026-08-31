# Configuration reference

The table is rendered from the authoritative configuration catalog used by the
Cloudflare Worker, Bun runtime, Docker deployment checks, and administration
API. The same catalog owns every setting's default, constraint, secrecy, and
runtime applicability. The Configuration page consumes its safe operator
projection: non-secret effective values plus credential presence and source,
never secret values or file paths. For Bun, a credential's `_FILE` setting is
mutually exclusive with its direct setting.

<!-- configuration-reference -->

Cloudflare-specific D1 and rate-limit bindings are configured in
`apps/push-gateway/wrangler.jsonc`. Docker Compose additionally consumes its
host-side version and port settings without passing them to the Bun process.
