# Maintain one contract across deployment targets

The gateway will have one runtime-neutral core with first-class adapters for Cloudflare Workers with D1 and self-hosted Bun with SQLite. Both targets must preserve the same Matrix API, FCM behavior, privacy rules, retry coordination, and safety limits; Cloudflare remains the default zero-cost deployment, while self-hosting supports one Bun service instance with one local persistent SQLite database behind an external TLS proxy. Each deployment remains single-tenant for one compatible app operator, and release merges publish hardened versioned Docker images for AMD64 and ARM64 alongside the existing Worker release.

Horizontal replicas, network-hosted SQLite files, built-in TLS termination, and Trinity client development are outside this decision. Supporting those capabilities later requires a new storage or deployment design rather than runtime-specific behavior in the shared gateway core.
