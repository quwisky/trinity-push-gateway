# Gate administration releases with real OIDC providers

Administration-capable releases must pass three layers of evidence: the fast deterministic `oidc-provider` protocol suite, an assembled-image smoke and isolation suite, and browser login tests against pinned disposable Pocket ID and Authentik services. The real-provider layer covers allowed and denied users, exact redirect and logout URIs, Operator Session creation, deep-link preservation, provider-outage isolation, and a directly uploaded browser screenshot.

Pull requests run the deterministic suite and Pocket ID compatibility. Scheduled and release-capable runs also require Authentik compatibility. Provider services and credentials are created only for a run; credentials are generated, masked, written with restrictive permissions, excluded from artifacts, and destroyed with the disposable services. FCM remains mocked because this gate verifies the operator boundary rather than mobile delivery credentials.

The production image is built once for each gate and must be the same artifact exercised by the smoke, provider, and size checks. It contains only the minified Bun bundle, compiled browser assets, and canonical gateway and administration migrations; it excludes sources, source maps, tests, package-manager state, and `node_modules`. Runtime validation requires numeric UID and GID 1000, a read-only root filesystem, and a writable `/data` volume.

An administration benchmark alternates disabled and enabled runs against the same delivery endpoint, requires zero notification errors while metrics persistence fails and backup or cleanup work runs, and rejects a sustained median p95 regression above five percent. A single noisy round does not fail the gate.
