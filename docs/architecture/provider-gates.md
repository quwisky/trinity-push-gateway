# Real OIDC provider gates

Administration authentication has three verification layers: deterministic
protocol tests, a real Pocket ID gate, and a real Authentik gate. The real
provider jobs exercise the assembled production image rather than a development
server. They use disposable provider data and do not contact Firebase.

## Shared provider lifecycle

One provider-gate lifecycle owns each Pocket ID and Authentik run from start to
finish:

1. create masked credentials in a mode-`0600` work directory;
2. start the pinned provider and validate its discovery document;
3. provision the client, allowed group, and allowed and denied identities;
4. start the hardened assembled gateway image;
5. verify allowed login, group denial, deep-link return, and local logout in a
   headless browser;
6. stop the provider and prove that `/health` and Matrix notification handling
   remain available;
7. write sanitized evidence and destroy containers, volumes, and credentials.

Each adapter contains only genuine provider variance. Pocket ID provisions
through its HTTP API and exchanges one-time access tokens before following the
gateway redirect. Authentik provisions atomically through its mounted blueprint,
verifies the resulting users, group, and application through its API, and enters
credentials after following the redirect. Both adapters use the same lifecycle
for readiness, gateway launch, allowed and denied access, deep-link return,
exact logout, outage isolation, evidence, and cleanup. Pocket ID alone uses an
optional adapter hook to normalize its provider-hosted group-denial page;
Authentik returns denied identities through the gateway callback directly.

GitHub Actions and local runs invoke the same generic Nx entry point. One
provider matrix selects the real adapter and invokes the
`push-gateway:provider-gate` target for both the run and its cleanup fallback.
Selection and release aggregation are executable policies covered by fast
tests; the workflow only supplies event data and job results. CI uploads each
sanitized JSON result and browser screenshot directly as a workflow artifact;
neither belongs in Git.

A deterministic OIDC mock adapter exercises the complete lifecycle interface
without Docker or browser startup. It proves orchestration, evidence, and
fail-closed cleanup quickly, but it is deliberately excluded from the real
adapter registry and cannot replace either Pocket ID or Authentik release gate.

## Run it locally

You need Linux Docker with host networking, Node and pnpm versions matching the
repository, and Chromium for Playwright. Build the exact image and install the
browser once:

```sh
docker build \
  --file apps/push-gateway/Dockerfile \
  --tag trinity-push-gateway:provider-gate \
  .
pnpm exec playwright install chromium
```

Then run the lifecycle with a stable run ID:

```sh
PROVIDER_GATE_PROVIDER=pocket-id \
  PROVIDER_GATE_RUN_ID=local-pocket-id \
  pnpm nx run push-gateway:provider-gate --skipNxCache

PROVIDER_GATE_PROVIDER=authentik \
  PROVIDER_GATE_RUN_ID=local-authentik \
  pnpm nx run push-gateway:provider-gate --skipNxCache
```

Evidence is written below the ignored `test-output/provider-gates/` directory.
The lifecycle cleans up after both success and failure. If the process is
forcibly interrupted, reuse the same run ID with the cleanup entry point:

```sh
PROVIDER_GATE_OPERATION=cleanup \
  PROVIDER_GATE_PROVIDER=pocket-id \
  PROVIDER_GATE_RUN_ID=local-pocket-id \
  pnpm nx run push-gateway:provider-gate --skipNxCache

PROVIDER_GATE_OPERATION=cleanup \
  PROVIDER_GATE_PROVIDER=authentik \
  PROVIDER_GATE_RUN_ID=local-authentik \
  pnpm nx run push-gateway:provider-gate --skipNxCache
```

`PROVIDER_GATE_WORK_DIRECTORY` and `PROVIDER_GATE_EVIDENCE_DIRECTORY` select
base directories; the lifecycle creates and removes only its run-specific child
under each base. `PROVIDER_GATE_RUN_ID` and
`PROVIDER_GATE_IMAGE` may override their defaults. The work and evidence paths
must be separate directory trees so an artifact upload can never include
credentials, including after an interrupted run.
