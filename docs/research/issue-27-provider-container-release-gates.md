# Issue 27: provider, container, and release-gate research

## Decision

Keep three distinct OIDC test layers and make their required contexts explicit:

1. Run the pinned local `oidc-provider@9.11.3` suite on every pull request that
   affects authentication or the Bun gateway. It is deterministic, requires no
   external service or secret, and is the fast protocol contract.
2. Run a pinned Pocket ID container suite on authentication-changing pull
   requests, the final integration pull request, and weekly on `master`.
3. Run a pinned Authentik server, worker, and PostgreSQL suite weekly, on manual
   request, on the final integration pull request, and on every pull request to
   `master` that can become a release. This includes a Release Please pull
   request before it is merged.

Both real-provider suites must pass before the first production release. They
must provision disposable users, groups, applications, clients, and secrets at
run time; no long-lived provider credential belongs in GitHub. A final stable
required check should aggregate the path-classification and provider results so
branch protection does not depend on dynamically absent job names.

The production image should use a Node/pnpm builder for the Angular application,
a Bun builder for the gateway, and a minimal Bun runtime stage containing only
the runtime bundles, browser assets, and gateway plus administration migrations.
The assembled image—not the Dockerfile text—is the release artifact to inspect
and exercise.

This decision implements the provider and release portions of
[#27](https://github.com/quwisky/trinity-push-gateway/issues/27). It retains the
OIDC selection and deterministic harness already recorded in
`docs/research/issue-22-oidc-session-selection.md`; it does not reopen that
selection.

## Repository baseline

At the time of this research:

- `apps/push-gateway/scripts/test-oidc-provider.mjs` already starts exact
  `oidc-provider@9.11.3` in a Node child on a loopback ephemeral port. Its two
  profiles reproduce Pocket ID's `groups` scope plus `client_secret_basic` and
  Authentik's profile-mapped `groups` plus `client_secret_post`.
- `apps/push-gateway/test/bun/auth/support/test-oidc-provider.ts` drives that
  child from Bun, owns cookies and redirects, and terminates it after the test.
- `.github/workflows/ci.yml` handles affected Nx checks and Release Please;
  `.github/workflows/container.yml` builds and smokes the image, including the
  compressed 150 MiB guard.
- The current image is non-root and its Compose service already uses a read-only
  root filesystem, drops capabilities, binds to loopback, and persists `/data`.
  Issue #27 still needs the Angular browser assets, administration migrations,
  full final-image inspection, and provider/container integration gates.

These are repository observations, not claims about the external products.

## Gate matrix

| Gate                          | Pull request                                                           | Scheduled                                     | Manual                          | Release consequence                                                                     |
| ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| Deterministic `oidc-provider` | Authentication or Bun-gateway affected; always on final integration PR | Optional redundancy                           | Useful for diagnosis            | Required wherever selected by the path classifier                                       |
| Pocket ID                     | Authentication-changing PRs and final integration PR                   | Weekly on `master`                            | Optional                        | Must be green before first production release                                           |
| Authentik                     | Final integration PR and every release-capable PR to `master`          | Weekly on `master`                            | Provider-selectable trusted ref | Must be green on the Release Please PR before merge and before first production release |
| Assembled container           | Container/gateway/UI affected PRs and release-capable PRs              | Exercise as part of both live-provider suites | Provider-selectable             | Size, contents, hardening, routes, and delivery must all pass                           |
| Aggregate `release-gates`     | Always present                                                         | Always present                                | Always present                  | Branch-protection status; succeeds only when every selected gate succeeded              |

Running Authentik on all release-capable pull requests to `master` is less
brittle than identifying Release Please from a mutable title or branch name. If
CI later narrows this condition, it must use trusted repository metadata and
changed release files, not title text alone.

The current gateway accepts non-TLS OIDC issuers only on loopback. Therefore,
the Linux CI topology must either give the assembled gateway container access
to the provider's host-loopback port for this test only, or terminate TLS at a
shared hostname. A plain `http://pocket-id:port` or
`http://authentik-server:port` Compose alias would test a configuration the
gateway correctly rejects; the provider, browser, and gateway must all observe
the same exact issuer.

GitHub scheduled workflows only run from the latest commit on the default
branch, and the workflow file must exist there. A weekly schedule therefore
validates `master`, not a still-unmerged integration branch
([GitHub Actions event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).
Use a non-hour-boundary UTC minute because GitHub warns that scheduled jobs can
be delayed or dropped during high load, especially at the start of an hour
([GitHub Actions event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)).

## Deterministic local OIDC provider

### Retained setup

Retain the exact, development-only `oidc-provider@9.11.3` dependency and its
Node 24 child-process boundary. The tagged package documents Node as its
runtime, while the maintainer explicitly does not claim Bun support
([v9.11.3 source](https://github.com/panva/node-oidc-provider/tree/v9.11.3),
[maintainer runtime answer](https://github.com/panva/node-oidc-provider/discussions/1250)).
Driving the Node process from Bun tests keeps the gateway under its production
runtime without depending on an unsupported provider runtime.

The harness should own all nondeterminism:

- listen on `127.0.0.1` with port `0`, then communicate the resolved issuer to
  the Bun parent through its existing structured startup line;
- use fixed account subjects, emails, groups, client IDs, redirect paths, and
  provider profiles;
- use a fixed test clock or explicit expiry offsets, isolated in-memory
  provider state, no outbound network access, and no environment-derived user
  identity;
- wait for the child startup contract before discovery, fail with captured
  child diagnostics, and always terminate and reap the child;
- cover success, missing group, wrong group, missing profile claim, callback
  replay, wrong state/nonce/issuer/audience, provider failure, and both client
  authentication methods.

The provider's configuration surface is explicitly application-owned, so the
harness must pin every behavior on which the gateway relies rather than inherit
changing defaults
([v9.11.3 configuration documentation](https://github.com/panva/node-oidc-provider/blob/v9.11.3/docs/README.md)).

Expose this suite as a named Nx target or a clearly named subset of the existing
Bun check. CI should classify changes to the authentication module, Bun adapter,
OIDC configuration/schema, migrations, provider harness, package lock, and its
own workflow as affected. This suite is the portable protocol baseline; it is
not evidence that either real provider still interoperates.

## Pocket ID gate

### Pinned topology and readiness

Pin the Pocket ID image to the intended release tag and immutable digest. The
release current for this research is `v2.14.0`
([Pocket ID v2.14.0 release](https://github.com/pocket-id/pocket-id/releases/tag/v2.14.0)).
Run one disposable container with a temporary data volume and these test-only
settings:

- a canonical `APP_URL` matching the issuer used by the gateway;
- generated `ENCRYPTION_KEY_FILE` and `STATIC_API_KEY` values;
- `ANALYTICS_DISABLED=true` and `VERSION_CHECK_DISABLED=true` so the gate does
  not depend on optional external calls;
- the documented UID/GID defaults of 1000 unless the test deliberately probes
  ownership.

Pocket ID documents `APP_URL`, file-backed encryption keys, static API keys,
UID/GID configuration, and the two offline switches in its environment
reference
([Pocket ID environment variables](https://pocket-id.org/docs/configuration/environment-variables)).
Its official Compose example invokes `/app/pocket-id healthcheck`
([official tagged Compose file](https://raw.githubusercontent.com/pocket-id/pocket-id/v2.14.0/docker-compose.yml)),
and the tagged healthcheck implementation probes `/healthz`
([healthcheck command](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/cmds/healthcheck.go)).
Because `/healthz` is a liveness response rather than proof that the configured
issuer and OIDC endpoints work
([health endpoint](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/controller/healthz_controller.go)),
the gate must wait for Docker health and then fetch discovery, validate its
exact issuer, and confirm the authorization, token, JWKS, and end-session
endpoints before provisioning users.

### Declarative test data

Use the static API key only inside the ephemeral runner to create:

1. an allowed group with a unique fixed test name;
2. one user in that group and one user outside it;
3. one confidential authorization-code client with the gateway's exact
   callback URI and PKCE flow;
4. a restriction from that client to the allowed group;
5. one client secret, captured once and immediately masked;
6. one-time access tokens for the two test users so browser automation does not
   require a human passkey.

Pocket ID's tagged routes expose OIDC client creation, secret creation, and
allowed-group updates
([OIDC client controller](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/controller/oidc_controller.go),
[OIDC DTOs](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/dto/oidc_dto.go)).
The official allowed-groups guide says a newly created OIDC client allows no
users until it is explicitly unrestricted or assigned one or more allowed
groups; this gate must assign only the operator group
([allowed groups](https://pocket-id.org/docs/configuration/allowed-groups)).
The tagged source authenticates the API through `X-API-Key`
([API-key middleware](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/middleware/api_key_auth.go))
and implements one-time login tokens for unattended access
([one-time access handler](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/onetimeaccess/handler.go)).

Configure the gateway with scopes `openid profile email groups`, group claim
`groups`, the exact required group, and `client_secret_basic`. Pocket ID's
official client-authentication guide specifies confidential clients with a
client ID and secret
([client authentication](https://pocket-id.org/docs/guides/oidc-client-authentication)),
and the tagged claim service emits an array of group names only when the
`groups` scope is requested
([claim service](https://github.com/pocket-id/pocket-id/blob/v2.14.0/backend/internal/oidc/claims_service.go)).

The gate must prove successful login, rejection of the non-member, local-first
logout/session revocation, provider-outage isolation, and that Matrix delivery
plus public health remain available while authentication fails. It must also
exercise the administration root and one deep link through the assembled image.

## Authentik gate

### Pinned topology and readiness

Pin Authentik server and worker images to the intended release tag and immutable
digest; use a matching PostgreSQL service. The release current for this
research is `2026.8.0`
([Authentik 2026.8.0 release](https://github.com/goauthentik/authentik/releases/tag/version/2026.8.0)).
The official Docker Compose installation comprises server and worker services
with PostgreSQL
([Docker Compose installation](https://docs.goauthentik.io/install-config/install/docker-compose),
[official Compose file](https://docs.goauthentik.io/compose.yml)).

Generate and mask the Authentik secret key, PostgreSQL password, bootstrap
token, test-user credential, and OAuth client secret at run time. Wait for:

1. PostgreSQL health;
2. the server and worker container health states;
3. server `/-/health/ready/` returning success;
4. discovery at the per-provider issuer returning the exact configured issuer
   and usable endpoints.

Authentik documents `/-/health/live/` as the running-process probe,
`/-/health/ready/` as including PostgreSQL connectivity, and `ak healthcheck`
for the worker
([Authentik monitoring](https://docs.goauthentik.io/sys-mgmt/ops/monitoring)).
Its image is built with UID 1000 and a built-in `ak healthcheck`
([tagged container Dockerfile](https://github.com/goauthentik/authentik/blob/version%2F2026.8.0/lifecycle/container/Dockerfile)).
Container health alone is therefore insufficient OIDC readiness; discovery and
issuer validation remain a separate gate step.

### Blueprint and OIDC data

Prefer a generated, runner-temporary Authentik blueprint. Create:

- the allowed group;
- an allowed user and a disallowed user;
- an OAuth2/OIDC provider using a confidential client, authorization code,
  PKCE, exact callback URI, per-provider issuer, and explicit
  `include_claims_in_id_token: true`;
- an application associated with that provider;
- the built-in `openid`, `profile`, and `email` scope mappings.

Authentik applies blueprints from mounted blueprint directories and treats a
blueprint transaction atomically
([blueprints](https://docs.goauthentik.io/customize/blueprints/)).
Blueprint version 1 supports model entries and references through `!KeyOf` and
`!Find`
([blueprint structure](https://docs.goauthentik.io/customize/blueprints/v1/structure/)),
while `!Env` and `!File` allow the generated secret values to stay out of the
committed blueprint
([blueprint tags](https://docs.goauthentik.io/customize/blueprints/v1/tags/)).
If API provisioning is easier to maintain, use an ephemeral
`AUTHENTIK_BOOTSTRAP_TOKEN`; Authentik documents that the token initializes the
`akadmin` account only during first startup
([automated install](https://docs.goauthentik.io/install-config/automated-install/)).

Authentik documents that an application is associated with an authentication
provider, normally one-to-one
([applications and providers](https://docs.goauthentik.io/add-secure-apps/providers/)).
Its OAuth2/OIDC provider supports authorization code, confidential client
credentials, PKCE, and a per-provider issuer rooted at
`/application/o/<slug>/`
([OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/)).
OAuth scope mappings add custom claims to tokens
([property mappings](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/)),
and the tagged default profile mapping emits `groups` as the user's group-name
array
([default OAuth mappings](https://github.com/goauthentik/authentik/blob/version%2F2026.8.0/blueprints/system/providers-oauth2.yaml)).
The tagged provider model includes an `include_claims_in_id_token` setting;
making it explicit ensures the gateway receives the mapped `groups` claim in
the ID token instead of depending on a provider default
([OAuth2 provider model](https://github.com/goauthentik/authentik/blob/version%2F2026.8.0/authentik/providers/oauth2/models.py)).

Configure the gateway with `openid profile email`, group claim `groups`, the
exact required group, and `client_secret_post`. Prove full browser login for
the member, group rejection, logout/local revocation, provider outage, and the
same assembled-image Matrix/health isolation checks as Pocket ID. Authentik's
greater startup cost is why it belongs in weekly, manual, integration, and
pre-release gates rather than every authentication implementation iteration.

## Production container contract

Docker recommends multi-stage builds so a final stage can copy only the
artifacts required at runtime and leave build tools behind
([multi-stage builds](https://docs.docker.com/build/building/multi-stage/),
[build best practices](https://docs.docker.com/build/building/best-practices/#use-multi-stage-builds)).
Bun's official Docker guide likewise separates dependency installation,
production dependencies, build, and release stages
([Bun Docker guide](https://bun.com/guides/ecosystem/docker)).

Use this stage contract:

1. **UI builder:** pinned Node and pnpm install from the frozen root lockfile,
   then the Nx production build for `push-gateway-ui`.
2. **Gateway builder:** pinned Bun stage consuming the frozen pnpm dependency
   tree, then bundle the Bun entry with production minification and explicit
   source maps disabled.
3. **Runtime:** pinned minimal Bun base, copying only Bun runtime bundles, UI
   browser output, gateway migrations, administration migrations, and any
   indispensable runtime metadata.

When a Bun application needs a runtime dependency tree,
`bun install --production` omits development dependencies and
`--frozen-lockfile` refuses lockfile drift
([Bun install](https://bun.com/docs/pm/cli/install)).
This gateway is bundled, so the stronger final-stage rule is to copy no
`node_modules` at all; the root pnpm install remains the single frozen-lockfile
dependency installation.
Bun documents `none` as the source-map mode that emits no source map; make that
choice explicit in the build and inspect the final filesystem for `*.map`
([Bun sourcemaps](https://bun.com/docs/bundler#sourcemap)).
`.dockerignore` reduces build context but does not prove that generated source
maps or development packages were not copied, so artifact inspection remains
mandatory
([Docker `.dockerignore` guidance](https://docs.docker.com/build/building/best-practices/#exclude-with-dockerignore)).

The final-image contract check must fail if it finds `node`, `npm`, `pnpm`,
`node_modules`, package-manager caches, source trees, TypeScript, source maps,
test fixtures, provider harnesses, or development-only dependencies. It must
also prove that both migration sets and all hashed browser assets exist and
that the compressed AMD64 image is at most 150 MiB. Keep the existing Worker
bundle ceiling and Angular initial/chunk budgets as independent gates; image
size cannot substitute for either.

Set the image user and group to numeric 1000 and inspect the built image's
`Config.User`. Docker recommends switching to a non-root `USER` when the
service does not need privileges
([Docker `USER` best practice](https://docs.docker.com/build/building/best-practices/#user),
[Dockerfile `USER`](https://docs.docker.com/reference/dockerfile/#user)).
Run the assembled image with:

- `--read-only` / Compose `read_only: true`;
- every Linux capability dropped and `no-new-privileges` enabled;
- only `/data` as a persistent writable volume;
- tmpfs mounts only for required ephemeral paths;
- loopback-only publication in the supplied Compose example.

Docker's read-only flag prevents writes to the container root filesystem
([`docker run --read-only`](https://docs.docker.com/reference/cli/docker/container/run/#read-only));
Compose separately defines `read_only`, `cap_drop`, and `tmpfs`
([Compose `read_only`](https://docs.docker.com/reference/compose-file/services/#read_only),
[Compose `cap_drop`](https://docs.docker.com/reference/compose-file/services/#cap_drop),
[Compose `tmpfs`](https://docs.docker.com/reference/compose-file/services/#tmpfs)).
Docker volumes are the persistent-data mechanism, so the gate must verify that
database, backup, and cleanup writes remain under `/data`
([Docker volumes](https://docs.docker.com/engine/storage/volumes/)).

The runtime healthcheck must use a utility present in the final image and prove
public gateway readiness. Docker uses healthcheck exit status to mark the
container `starting`, `healthy`, or `unhealthy`; it does not restart the
container by itself
([Dockerfile `HEALTHCHECK`](https://docs.docker.com/reference/dockerfile/#healthcheck)).
The smoke suite must therefore wait explicitly for healthy and retain logs on
failure without publishing secrets.

## GitHub Actions and secret handling

Add a dedicated provider workflow or reusable provider jobs with
`pull_request`, `schedule`, and `workflow_dispatch` entry points. GitHub only
accepts `workflow_dispatch` for a workflow present on the default branch, and a
manual run can target a selected ref
([GitHub Actions event documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)).
Use a typed manual input such as `provider: pocket-id | authentik | all`, record
the tested SHA in the summary, and accept only repository-owned refs for any
future job that receives privileged credentials.

The provider gates described here need no repository or environment secret:

- generate high-entropy credentials inside the job;
- immediately emit `::add-mask::<value>` for each generated value;
- put configuration and secret files under `$RUNNER_TEMP` with mode `0600`;
- pass secrets through environment variables or standard input, never command
  arguments or workflow output;
- clean containers, volumes, networks, and temporary files in an `always()`
  step;
- never upload provider databases, generated configuration, browser storage,
  raw container logs, or HTTP traces as artifacts.

GitHub recommends masking sensitive values that are not registered as Actions
secrets and avoiding command-line secret passing
([using secrets in Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)).
It also warns that structured secret blobs can defeat exact redaction, so keep
each credential a separate masked scalar
([Actions secrets reference](https://docs.github.com/en/actions/reference/security/secrets)).

If a future live external provider genuinely requires durable credentials,
place them in a protected `provider-release` environment and reference that
environment only from a trusted default-branch/manual job. Environment secrets
become available only to a job that references the environment and, when
protection is configured, only after its rules pass
([deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).
Normal secrets are not passed to fork pull requests or Dependabot-triggered
workflows, and reusable workflows do not receive them automatically
([using secrets in Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)).

Never use `pull_request_target` to build or execute pull-request code with an
elevated token or provider secret. GitHub's security guidance identifies that
combination as unsafe because untrusted pull-request code can obtain the
privileged context
([secure `pull_request_target` use](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)).
The normal `pull_request` event plus disposable local providers is sufficient
for this design.

## Implementation checklist

### Workflow and classification

- [ ] Add one path classifier covering authentication source, Bun source,
      migrations, UI/browser source, Docker/Compose, lockfile, provider scripts,
      and the workflow itself.
- [ ] Expose the deterministic provider suite as a named Nx target and select it
      for authentication/Bun changes.
- [ ] Add pinned-by-digest Pocket ID and Authentik provider jobs with isolated
      names, networks, volumes, and per-run credentials.
- [ ] Add weekly `master` schedule at an off-minute and a typed
      `workflow_dispatch` provider selector.
- [ ] Run Pocket ID on authentication-changing and final integration pull
      requests; run Authentik on final integration and all release-capable
      pull requests to `master`.
- [ ] Add an always-present `release-gates` aggregation job suitable for branch
      protection. Treat only deliberately skipped, non-selected jobs as success.
- [ ] Keep Release Please as the only version/changelog writer; provider and
      image gates only validate its pull request.

### Provider provisioning

- [ ] Pin Node, Bun, `oidc-provider`, both provider images, PostgreSQL, and every
      browser used by the gate.
- [ ] Reuse the existing Node-child deterministic harness; eliminate wall-clock,
      port, account, and cleanup races.
- [ ] Provision Pocket ID group, two users, confidential client, exact callback,
      group restriction, one-time login tokens, and one generated client secret
      whose value is captured once.
- [ ] Require Pocket ID Docker health plus exact discovery/issuer readiness.
- [ ] Provision Authentik through a generated blueprint or ephemeral bootstrap
      API: group, two users, provider, application, callback, mappings, and
      explicit ID-token claim inclusion.
- [ ] Require PostgreSQL, server, and worker health plus Authentik readiness and
      exact discovery/issuer checks.
- [ ] Prove successful and rejected group flows, local-first logout, provider
      outage isolation, and no provider token persistence for both products.

### Assembled image

- [ ] Add the Node/pnpm UI build stage and Bun production build stage.
- [ ] Copy only runtime bundles, browser assets, and both migration sets to the
      final Bun stage; explicitly disable source maps.
- [ ] Inspect the final filesystem for forbidden tools, sources, maps,
      development dependencies, and provider test code.
- [ ] Inspect numeric UID/GID 1000 and execute with read-only root, all
      capabilities dropped, no-new-privileges, and `/data` as the only
      persistent writable location.
- [ ] Retain the 150 MiB compressed AMD64 ceiling, Worker bundle ceiling, and
      Angular browser budgets as separate failures.
- [ ] Smoke public health, Matrix notification delivery, disabled/invalid admin
      behavior, admin root, deep link, assets, headers, 404/405 behavior, and
      both real OIDC logins from the assembled image.
- [ ] Exercise backup, cleanup, metrics-writer failure, and disabled/enabled
      benchmark paths under Matrix load; investigate sustained p95 regressions
      over issue #27's five-percent threshold.

### Secret and evidence hygiene

- [ ] Generate and mask every provider credential; keep files under
      `$RUNNER_TEMP` at mode `0600` and clean with `always()`.
- [ ] Do not expose credentials through command lines, step outputs, summaries,
      provider logs, browser traces, or uploaded artifacts.
- [ ] Upload only redacted test reports and image metadata required for
      diagnosis. Keep the issue's screenshots, GIFs, and benchmark evidence on
      the pull request rather than in the repository.
- [ ] Document the tested image digests, provider versions, trigger, and commit
      SHA in the Actions summary so a release result is reproducible.

## Primary-source register

- OIDC harness: [`oidc-provider` v9.11.3](https://github.com/panva/node-oidc-provider/tree/v9.11.3)
- Pocket ID: [installation](https://pocket-id.org/docs/setup/installation),
  [environment](https://pocket-id.org/docs/configuration/environment-variables),
  [OIDC client authentication](https://pocket-id.org/docs/guides/oidc-client-authentication),
  [allowed groups](https://pocket-id.org/docs/configuration/allowed-groups), and
  [v2.14.0 tagged source](https://github.com/pocket-id/pocket-id/tree/v2.14.0)
- Authentik: [Docker Compose installation](https://docs.goauthentik.io/install-config/install/docker-compose),
  [monitoring](https://docs.goauthentik.io/sys-mgmt/ops/monitoring),
  [OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/),
  [blueprints](https://docs.goauthentik.io/customize/blueprints/), and
  [2026.8.0 tagged source](https://github.com/goauthentik/authentik/tree/version/2026.8.0)
- Container: [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/),
  [Docker build practices](https://docs.docker.com/build/building/best-practices/),
  [Compose services](https://docs.docker.com/reference/compose-file/services/),
  and [Bun's Docker guide](https://bun.com/guides/ecosystem/docker)
- CI: [GitHub Actions events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows),
  [secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets),
  and [environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
