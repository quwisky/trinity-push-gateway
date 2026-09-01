# Configuration reference

The table is rendered from the authoritative configuration catalog used by the
Cloudflare Worker, Bun runtime, Docker deployment checks, and administration
API. The same catalog owns every setting's default, constraint, secrecy, and
runtime applicability. The Configuration page consumes its safe operator
projection: non-secret effective values plus credential presence and source,
never secret values or file paths. The Bun route validates that projection with
the canonical configuration response contract; the published OpenAPI schema
and generated UI client come from that same definition. For Bun, a credential's
`_FILE` setting is mutually exclusive with its direct setting. Documentation
reads the catalog through its public lookup and runtime-filtered listing
interface; it does not maintain a separate name, default, or metadata list.

<!-- configuration-reference -->

Cloudflare-specific D1 and rate-limit bindings are configured in
`apps/push-gateway/wrangler.jsonc`. Docker Compose additionally consumes its
host-side version and port settings without passing them to the Bun process.
The deployment contract resolves the Compose files and examples with Docker
Compose, then loads the effective environment through the same Bun and
administration configuration interfaces used at startup.
