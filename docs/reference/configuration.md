# Configuration reference

The table is rendered from the typed configuration reference used by repository
contract tests. Secrets have no documented value. For Bun, a credential's
`_FILE` setting is mutually exclusive with its direct setting.

<!-- configuration-reference -->

Cloudflare-specific D1 and rate-limit bindings are configured in
`apps/push-gateway/wrangler.jsonc`. Docker Compose additionally consumes its
host-side version and port settings without passing them to the Bun process.
