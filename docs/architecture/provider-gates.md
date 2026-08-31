# Real OIDC provider gates

Administration authentication has three verification layers: deterministic
protocol tests, a real Pocket ID gate, and a real Authentik gate. The real
provider jobs exercise the assembled production image rather than a development
server. They use disposable provider data and do not contact Firebase.

## Pocket ID lifecycle

One provider-gate lifecycle owns the Pocket ID run from start to finish:

1. create masked credentials in a mode-`0600` work directory;
2. start the pinned provider and validate its discovery document;
3. provision the client, allowed group, and allowed and denied identities;
4. start the hardened assembled gateway image;
5. verify allowed login, group denial, deep-link return, and local logout in a
   headless browser;
6. stop Pocket ID and prove that `/health` and Matrix notification handling
   remain available;
7. write sanitized evidence and destroy containers, volumes, and credentials.

The Pocket ID adapter contains only Pocket ID API and browser variance. GitHub
Actions and local runs invoke the same Nx target. CI uploads the sanitized JSON
result and browser screenshot directly as a workflow artifact; neither belongs
in Git.

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
PROVIDER_GATE_RUN_ID=local-pocket-id \
  pnpm nx run push-gateway:provider-gate-pocket-id --skipNxCache
```

Evidence is written below the ignored `test-output/provider-gates/` directory.
The lifecycle cleans up after both success and failure. If the process is
forcibly interrupted, reuse the same run ID with the cleanup entry point:

```sh
PROVIDER_GATE_RUN_ID=local-pocket-id \
  pnpm nx run push-gateway:provider-gate-pocket-id-cleanup --skipNxCache
```

`PROVIDER_GATE_WORK_DIRECTORY` and `PROVIDER_GATE_EVIDENCE_DIRECTORY` select
base directories; the lifecycle creates and removes only its run-specific child
under each base. `PROVIDER_GATE_RUN_ID` and
`PROVIDER_GATE_IMAGE` may override their defaults. The work and evidence paths
must be separate directory trees so an artifact upload can never include
credentials, including after an interrupted run.
