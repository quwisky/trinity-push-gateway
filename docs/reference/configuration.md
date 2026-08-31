# Configuration reference

The table is rendered from the typed configuration reference used by repository
contract tests. The administration enable setting and both Operator Session
secret sources are projected from the same authoritative catalog that loads
them at runtime and produces their safe operator state. When enabled, the
response and Configuration page expose only the public `true` state plus the
secret's configured/source metadata; the remaining entries stay on the
compatibility reference until their staged migration. Secrets have
no documented value. For Bun, a credential's `_FILE` setting is mutually
exclusive with its direct setting.

<!-- configuration-reference -->

Cloudflare-specific D1 and rate-limit bindings are configured in
`apps/push-gateway/wrangler.jsonc`. Docker Compose additionally consumes its
host-side version and port settings without passing them to the Bun process.
