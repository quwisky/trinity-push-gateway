# Use Hono for Bun administration routing

The Bun-only operator BFF will use exactly pinned Hono for its fixed positive route surface, cookie handling, and Fetch-native request composition. Gateway-owned modules retain authentication, authorization, response validation, security headers, static-asset allowlisting, and failure isolation; Hono remains absent from the Cloudflare Worker and Matrix delivery router.

This decision supersedes only ADR 0025's four-package workspace runtime ceiling by admitting Hono as a fifth, Bun-only dependency. ADR 0025's `openid-client` choice and every existing Worker dependency and bundle constraint remain in force.
