# Use Zod at untrusted boundaries

The gateway and its self-hosted operator surface will use exactly pinned Zod to validate data at untrusted boundaries. One schema vocabulary can cover the existing Matrix, configuration, OAuth, and FCM boundaries and the versioned operator API without maintaining a second validation model alongside its contract tooling; the migration must preserve Matrix rejection and unknown-field semantics.

This decision supersedes ADR 0013 only where it selected Valibot. ADR 0013's focused-dependency policy, `jose` ownership of PKCS#8 import and RS256 signing, direct FCM HTTP v1 delivery, gateway-owned OAuth, caching, retry, payload, and error-classification behavior, and bundle enforcement remain in force.
