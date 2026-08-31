# Issue 22: OIDC and session implementation selection

## Decision

Use **`openid-client@6.8.7`** as the only OIDC dependency. Do not add Better Auth.

Better Auth 1.7.2 fails the first mandatory implementation gate after the core
OIDC protocol checks: its OAuth state is valid for ten minutes, while issue #22
requires a one-use state with a five-minute lifetime. Its OAuth parser also
reads and then deletes the verification row as two operations even though the
same internal adapter exposes a race-safe consume primitive. The exact code is
visible in [`oauth2/state.ts`](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/oauth2/state.ts#L56-L74),
[`state.ts`](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/state.ts#L215-L290),
and the unused race-safe replacement in
[`internal-adapter.ts`](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/db/internal-adapter.ts#L1367-L1500).
That is independently disqualifying under the issue's “any Better Auth gate
fails” rule. Later gates also fail, so changing only the state lifetime would
not alter the selection.

`openid-client` deliberately supplies the OIDC protocol machinery without
owning application routes, identities, sessions, or database records. Its exact
6.8.7 source exposes discovery, confidential client authentication, PKCE,
authorization-code processing, validated claims, and RP-initiated logout
primitives in one small module
([source](https://github.com/panva/openid-client/blob/v6.8.7/src/index.ts),
[runtime support](https://github.com/panva/openid-client/blob/v6.8.7/README.md#supported-runtimes)).
The gateway can therefore implement the issue's exact Drizzle schema and HTTP
contract without bypassing a second auth framework.

## Scope and method

This was a time-boxed spike against the exact package versions, official tagged
source, package tarballs, provider documentation, OIDC/OAuth specifications,
and committed executable contracts. A Bun 1.4 client drives
`oidc-provider@9.11.3` in a supported Node child using separate Pocket-ID-like
and Authentik-like scope/claim profiles. It did not stand up the two products
themselves; literal external-product smoke remains a production-foundation gate.

Status meanings:

- **PASS**: tagged source, a recorded exact-package probe, and/or a committed
  contract test proves the behavior.
- **FAIL**: the exact package's behavior contradicts a mandatory gate or would
  require bypassing/forking its core model.
- **DEFERRED TO #24**: the selected design is proven feasible here, but the
  production administration database or router intentionally does not exist
  until the isolated Bun administration-foundation ticket.

The Better Auth candidate was the documented minimal initializer plus the
generic OIDC plugin, with its exported Drizzle adapter. The minimal initializer
only changes initialization; it still builds Better Auth's core endpoint set
([minimal source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/auth/minimal.ts),
[base source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/auth/base.ts)).
The adapter export is a re-export of `@better-auth/drizzle-adapter`
([export source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/adapters/drizzle-adapter/index.ts)).
Isolated Node 24 probes then ran exact `better-auth@1.7.2` minimal plus generic
OIDC against exact `oidc-provider@9.11.3`, first through its exported memory
adapter and then its exported Drizzle adapter backed by SQLite. Both
deterministic provider profiles completed through both adapters, but
instrumentation reproduced the mandatory state failure: a 600,000 ms
verification lifetime, separate lookup and deletion, zero atomic consume calls,
and two token requests from duplicated concurrent callbacks. The losing
packages and probe installations were removed; the reusable provider suite
remains committed only for the selected implementation.

## Provider and standards baseline

Pocket ID documents confidential authorization-code clients with a client ID
and secret, and documents the `groups` claim in its client examples
([client authentication](https://pocket-id.org/docs/guides/oidc-client-authentication),
[groups example](https://pocket-id.org/docs/client-examples/opencloud)).
Authentik documents OIDC authorization code, confidential `client_id` and
`client_secret` exchange, PKCE, discovery issuer behavior, and scope/property
mapping for group claims
([OAuth2/OIDC provider](https://docs.goauthentik.io/add-secure-apps/providers/oauth2/),
[property mappings](https://docs.goauthentik.io/add-secure-apps/providers/property-mappings/)).
These are compatible protocol shapes and the deterministic profiles pass; live
product interoperability is explicitly deferred to the production foundation's
one smoke test per product.

The security checks below follow OIDC discovery issuer matching
([Discovery 1.0 section 4.3](https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfigurationValidation)),
ID-token issuer, audience, and nonce validation
([OIDC Core sections 3.1.3.7 and 3.1.3.8](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)),
PKCE S256
([RFC 7636 section 4.6](https://www.rfc-editor.org/rfc/rfc7636.html#section-4.6)),
and RP-initiated logout discovery
([RP-Initiated Logout 1.0](https://openid.net/specs/openid-connect-rpinitiated-1_0.html)).

## Decision matrix

### OIDC protocol and provider behavior

| Issue #22 gate                                      | Better Auth 1.7.2 minimal + generic OIDC                              | Better Auth 1.7.2 Drizzle export                  | `openid-client@6.8.7`                                                                     | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generic Pocket ID and Authentik OIDC                | **PASS for temporary deterministic profiles; candidate not retained** | **PASS in the temporary Drizzle-backed profiles** | **PASS for retained deterministic provider profiles; live-product smoke deferred to #24** | The exact Better Auth probes completed one Pocket-ID-like `groups`-scope flow with `client_secret_basic` and one Authentik-like profile-mapped flow with `client_secret_post` through both its memory and exported Drizzle adapters; each flow created one identity/account/session set. The retained Bun suite drives the same two protocol shapes through the selected module. Product-specific scopes and issuer constraints come from the primary provider sources above.                                                                                                                                                                                                                                                              |
| Confidential authorization code                     | **PASS**                                                              | N/A                                               | **PASS**                                                                                  | Better Auth recognizes `client_secret_basic` and `client_secret_post` in the [generic plugin](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/generic-oauth/index.ts#L71-L87). `openid-client` exports both methods and authorization-code processing in its [tagged source](https://github.com/panva/openid-client/blob/v6.8.7/src/index.ts#L70-L245).                                                                                                                                                                                                                                                                                                                                            |
| PKCE S256                                           | **PASS**                                                              | N/A                                               | **PASS**                                                                                  | Better Auth constructs S256 when a verifier is supplied ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/oauth2/create-authorization-url.ts#L68-L92)). `openid-client` generates a verifier and S256 challenge ([source](https://github.com/panva/openid-client/blob/v6.8.7/src/index.ts#L890-L939)).                                                                                                                                                                                                                                                                                                                                                                                                    |
| Discovery and JWKS                                  | **PASS**                                                              | N/A                                               | **PASS**                                                                                  | Better Auth reads discovery and constructs a remote JWKS set ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/generic-oauth/index.ts#L204-L252)). `openid-client` exposes discovery and uses `oauth4webapi`; exact issuer comparison occurs in the pinned transitive implementation ([source](https://github.com/panva/oauth4webapi/blob/v3.8.7/src/index.ts#L1600-L1617)).                                                                                                                                                                                                                                                                                                               |
| Exact issuer, audience, state, and nonce validation | **PASS** for token checks                                             | N/A                                               | **PASS**                                                                                  | Better Auth passes issuer, client-ID audience, algorithms, and nonce to JOSE ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/oauth2/verify-id-token.ts#L59-L111)). `openid-client` passes expected state and nonce into the authorization-code processor ([source](https://github.com/panva/openid-client/blob/v6.8.7/src/index.ts#L3324-L3368)); its pinned engine performs the ID-token claim validation ([source](https://github.com/panva/oauth4webapi/blob/v3.8.7/src/index.ts#L3770-L3868)).                                                                                                                                                                                                      |
| One-use, five-minute login state                    | **FAIL — first disqualifier**                                         | **FAIL**                                          | **PASS** by gateway ownership                                                             | The exact Better Auth probe measured a 600,000 ms verification lifetime and `findMany`/`deleteMany` consumption with zero atomic-consume calls. Duplicated concurrent callbacks both reached the token endpoint; only the provider's one-use code rejected the second. Tagged source matches the result ([state creation](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/oauth2/state.ts#L56-L74), [state parsing](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/state.ts#L215-L290)). The selected gateway path atomically `DELETE … RETURNING`s a row whose expiry is at most five minutes before code exchange.                                                      |
| Required group claim and exact membership           | **PASS** with a rejecting `mapProfileToUser`                          | N/A                                               | **PASS** by gateway ownership                                                             | Better Auth exposes the verified provider profile to a mapper ([plugin configuration](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/generic-oauth/types.ts)); `openid-client` exposes validated ID-token claims ([source](https://github.com/panva/openid-client/blob/v6.8.7/src/index.ts#L2034-L2100)). The gateway must validate that the configured claim is an array of strings and contains the configured group before persistence.                                                                                                                                                                                                                                                        |
| Fixed login, callback, and logout routes            | **FAIL**                                                              | N/A                                               | **PASS at the route-free seam; route enforcement deferred to #24**                        | Better Auth registers `signIn.social` and `callback/:id`, not the fixed gateway surface ([plugin source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/generic-oauth/index.ts#L171-L177)). `openid-client` registers no routes, so the later Bun router can expose only the three fixed paths.                                                                                                                                                                                                                                                                                                                                                                                                   |
| RP-initiated logout                                 | **FAIL for portable token-free return semantics**                     | N/A                                               | **PASS for URL construction; local route and product behavior deferred to #24**           | `openid-client` builds the discovered end-session URL with `client_id` and no retained token ([source](https://github.com/panva/openid-client/blob/v6.8.7/src/index.ts#L4150-L4205)). Pocket ID needs an ID-token hint to identify/revoke the authorization and return to a registered callback ([source](https://github.com/pocket-id/pocket-id/blob/main/backend/internal/oidc/end_session_service.go)); Authentik requires one when `post_logout_redirect_uri` is supplied ([source](https://github.com/goauthentik/authentik/blob/main/authentik/providers/oauth2/views/end_session.py)). The selected module proves token-free URL construction; #24 must prove local-first revocation and each real provider's best-effort behavior. |

### Privacy, identity, and public surface

| Issue #22 gate                                                   | Better Auth 1.7.2 minimal + generic OIDC     | Better Auth 1.7.2 Drizzle export | `openid-client@6.8.7`         | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No provider token reaches browser; no provider token is retained | **FAIL**                                     | **FAIL**                         | **PASS** by gateway ownership | Better Auth carries all returned tokens into account data ([callback source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/callback.ts#L362-L381)), persists access, refresh, and ID tokens ([linking source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/oauth2/link-account.ts#L405-L435)), and defines those columns in its core schema ([schema](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/db/get-tables.ts#L293-L326)). `openid-client` has no persistence or response layer; the gateway can keep the token response callback-local and persist none of it. |
| Identity key is exactly `(issuer, subject)`                      | **FAIL**                                     | **FAIL**                         | **PASS** by gateway ownership | Better Auth does have an issuer/account-ID uniqueness constraint ([schema](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/db/get-tables.ts#L251-L291)), but a missing account falls back to an email lookup ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/oauth2/link-account.ts#L110-L170)). A dedicated gateway table can make `(issuer, subject)` the sole identity key.                                                                                                                                                                                                                                 |
| Email linking disabled                                           | **FAIL** for the required identity semantics | **FAIL**                         | **PASS** by gateway ownership | Better Auth's `disableImplicitLinking` blocks linking after the email fallback, but it does not turn same-email, distinct subjects into independent identities ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/oauth2/link-account.ts#L110-L170)). The gateway need not query by email at all.                                                                                                                                                                                                                                                                                                                                          |
| Name/email optional, mutable, and prunable                       | **FAIL**                                     | **FAIL**                         | **PASS** by gateway ownership | Better Auth rejects a callback without email and substitutes an empty name ([callback](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/callback.ts#L362-L381)); its user table requires and uniquely indexes email ([schema](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/db/get-tables.ts#L197-L244)). A gateway-owned profile projection can store nullable values, update them on login, and prune them independently.                                                                                                                                                                                  |
| Authentication telemetry disabled                                | **PASS**                                     | **PASS**                         | **PASS**                      | Better Auth telemetry is disabled by default and can be explicitly disabled ([official docs](https://www.better-auth.com/docs/reference/telemetry)); `openid-client` contains no product telemetry facility in its [package source](https://github.com/panva/openid-client/tree/v6.8.7). The gateway should nevertheless set an explicit no-telemetry configuration where available.                                                                                                                                                                                                                                                                                              |
| Positive route allowlist                                         | **FAIL**                                     | N/A                              | **PASS** by gateway ownership | Better Auth exposes a core router and supplies only a negative `disabledPaths` option ([type](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/types/init-options.ts#L1760-L1775), [router check](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/index.ts#L287-L305)). `openid-client` registers no routes, so only the gateway's explicit allowlist exists.                                                                                                                                                                                                                                                         |

### Sessions, transactions, runtime, and isolation

| Issue #22 gate                                          | Better Auth 1.7.2 minimal + generic OIDC     | Better Auth 1.7.2 Drizzle export       | `openid-client@6.8.7`                                                              | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | -------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opaque session token                                    | **PASS**                                     | **PASS**                               | **PASS** by gateway ownership                                                      | Better Auth creates a random 32-character token ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/db/internal-adapter.ts#L467-L520)). The gateway can generate and store its own opaque random token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 30-minute idle and 8-hour absolute expiry               | **FAIL**                                     | **FAIL**                               | **PASS** by gateway ownership                                                      | Better Auth models one `expiresIn` plus refresh `updateAge` ([options](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/types/init-options.ts#L1015-L1045)) and refreshes the expiration during session reads ([route](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/session.ts#L311-L384)); it has no independent immutable absolute deadline. The gateway table can store both timestamps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Policy-fingerprint invalidation                         | **FAIL**                                     | **FAIL**                               | **PASS** by gateway ownership                                                      | Better Auth's session schema has no policy fingerprint ([schema](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/db/get-tables.ts#L128-L196)). A gateway-owned session row can compare the current normalized-policy hash on every authenticated request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Five sessions per identity and 100 globally             | **FAIL**                                     | **FAIL**                               | **PASS** by gateway ownership                                                      | Better Auth's multi-session plugin has one `maximumSessions` option and implements a browser-session list, not two transactional database caps ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/multi-session/index.ts#L33-L60), [enforcement](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/multi-session/index.ts#L320-L375)). The gateway must enforce both caps transactionally with a deterministic oldest-session eviction policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Immediate revocation                                    | **PASS** with cookie cache off               | **PASS**                               | **PASS at policy/feasibility seam; production route deferred to #24**              | Better Auth has database-backed revoke endpoints and cache controls ([session API](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/session.ts)); the gateway feasibility adapter proves an idempotent revocation write and the policy rejects a marked session immediately. #24 must wire the same behavior to local-first logout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Strict host-only secure cookie                          | **PASS** with configuration                  | N/A                                    | **PASS** by gateway ownership                                                      | Better Auth cookies are configurable and default to HttpOnly with environment-dependent Secure and SameSite Lax ([source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/cookies/index.ts#L44-L124)), so the issue's Strict setting is not the default. The gateway can emit the exact host-only `Secure; HttpOnly; SameSite=Strict; Path=/` cookie.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Exact-Origin enforcement and session-bound XSRF         | **FAIL** for the exact contract              | N/A                                    | **PASS** by gateway ownership                                                      | Better Auth documents origin and CSRF controls, but its standard contract is not the required readable XSRF cookie plus matching header bound to the opaque session ([security docs](https://www.better-auth.com/docs/reference/security)). A small gateway guard can perform exact URL-origin comparison and constant-time token comparison before every state-changing route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Atomic rollback of login/session writes                 | **FAIL**                                     | **FAIL** on Bun SQLite                 | **PASS in the Bun/Drizzle feasibility adapter; production repeat deferred to #24** | Better Auth creates user/account inside one transaction but creates the session afterward ([linking source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/oauth2/link-account.ts#L405-L435), [later session creation](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/oauth2/link-account.ts#L500-L540)). Its Drizzle adapter disables transactions by default and, when enabled, passes Better Auth's async callback into `db.transaction` ([adapter](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/drizzle-adapter/src/drizzle-adapter.ts#L1189-L1202), [async caller](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/context/transaction.ts#L99-L159)); Drizzle's Bun SQLite transaction callback is synchronous ([Drizzle 0.45.2 source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/session.ts#L52-L78)). Fault injection after identity and session writes proves rollback in a temporary adapter that #24 will replace under the same contract. |
| Bun runtime compatibility                               | **FAIL** as a complete candidate             | **FAIL** for safe transactions         | **PASS** for module compatibility                                                  | Both exact candidates bundled and imported under Bun 1.4.0 in this spike. `openid-client` also lists Bun as a supported runtime ([official matrix](https://github.com/panva/openid-client/blob/v6.8.7/README.md#supported-runtimes)). Better Auth still fails the runtime's required transactional behavior above.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Bun bundle and image budget                             | **FAIL** relative to the focused alternative | **FAIL**                               | **PASS for the selected module and current image policy**                          | The comparative proxy measured Better Auth at 607,493 raw/165,968 gzip bytes versus `openid-client` at 28,131 raw/9,253 gzip bytes. The retained, validated module is 53,722 raw/17,206 gzip bytes; the existing Bun entry remains 269,812 raw bytes until #24 wires it. Pull-request container CI measured 163,202,149 unpacked and 73,793,454 compressed bytes, passing the 157,286,400-byte ceiling with 83,492,946 bytes of headroom.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Cloudflare Worker isolation and unchanged Worker bundle | **FAIL risk from the broad candidate**       | **FAIL risk from the broad candidate** | **PASS**                                                                           | The normalized Worker source-map guard remains exactly 103 inputs with SHA-256 `f114f64628e2ac16a709ea20d5c6ae8c79429df1c79fb4fd33a78c3e9ec54d21`; it rejects `openid-client`, `oauth4webapi`, Better Auth, `oidc-provider`, and every Bun source. The artifact remains 302,263 raw/62,570 gzip bytes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Exact artifact and bundle observations

The package metadata explains the measured difference. Better Auth 1.7.2's
package exports include its minimal initializer and Drizzle adapter, while its
root dependency set includes its adapters, telemetry package, Kysely, JOSE,
Nanostores, and Zod
([exact `package.json`](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/package.json)).
`openid-client@6.8.7` has two runtime dependencies, `jose` and
`oauth4webapi`
([exact `package.json`](https://github.com/panva/openid-client/blob/v6.8.7/package.json)).
The registry tarballs were 375.7 kB compressed/2.1 MB unpacked for Better Auth
and 43.9 kB compressed/224.5 kB unpacked for `openid-client`.

The Bun proxy imported only the candidate features needed by this issue:

```text
better-auth/minimal + better-auth/adapters/drizzle + generic-oauth
  434 bundled modules; 607,493 bytes raw; 165,968 bytes gzip

openid-client discovery + code grant + PKCE/state/nonce + logout
   23 bundled modules;  28,131 bytes raw;   9,253 bytes gzip
```

The measurement used Bun 1.4.0 with ESM, `--target=bun`, minification, and an
import smoke test. It is a comparative feature-import proxy, not a final image
or production bundle claim. The delivery gate remains the real
`push-gateway` Bun artifact, compressed image delta, and unchanged Worker
artifact.

### Temporary Better Auth executable probe

The isolated compatibility probes used Node 24.20.0, exact
`better-auth@1.7.2`, and exact `oidc-provider@9.11.3`. The first ran
`better-auth/minimal` plus `genericOAuth` through a logging proxy around Better
Auth's exported memory adapter. The second repeated the suite through the
exported `drizzleAdapter` and `@better-auth/drizzle-adapter@1.7.2`, with exact
`drizzle-orm@0.45.2`, `better-sqlite3@12.11.1`, and the standard Better Auth
SQLite schema. It retained the adapter's default `transaction: false` setting:

- Pocket-ID-like `openid profile email groups`, `groups` claim, and
  `client_secret_basic`: S256 authorization, login, consent, mapping, and the
  callback completed with one token request.
- Authentik-like `openid profile email`, profile-mapped `groups` claim, and
  `client_secret_post`: the same flow completed with one token request.
- Each login created one verification row whose measured database lifetime was
  exactly 600,000 ms. Across both adapters its embedded expiry was
  599,995–600,000 ms from row creation even though the signed state cookie used
  `Max-Age=300`.
- Memory-adapter instrumentation recorded lookup followed by deletion and zero
  calls to the adapter's atomic consume operation. Drizzle recorded
  `SELECT, SELECT, DELETE, SELECT, DELETE` with no `DELETE … RETURNING`.
- Through each adapter, two concurrent callbacks both passed state lookup and
  made token requests: one completed, while the provider rejected the duplicated
  authorization code.

This probe confirms basic provider-shape compatibility and independently
reproduces the first mandatory failure found in tagged source. The Drizzle
rerun proves the default nontransactional adapter path, while the separate
tagged-source analysis above establishes why enabling its async transaction
wrapper is incompatible with synchronous Bun SQLite transactions. Both
temporary installations were deleted after execution; neither Better Auth nor
its adapter remains in the dependency graph.

## Committed delivery evidence

The selected module and reusable contracts close the static spike's unknowns:

- `bun test test/bun/auth` passes 37 tests. A Bun 1.4 client drives an exact
  `oidc-provider@9.11.3` Node child through Pocket-ID-like and Authentik-like
  scope/claim profiles and both `client_secret_basic` and
  `client_secret_post`. Controlled signed-token fixtures reject expired,
  wrong-issuer, wrong/multiple-audience, wrong-nonce, and wrong-signature ID
  tokens. The signature case requires and proves explicit
  `enableNonRepudiationChecks` plus JWKS verification.
- Login attempts are stored only behind a digest-keyed behavioral port, expire
  at exactly 300 seconds with defense-in-depth enforcement, and are atomically
  consumed before the token request. A callback must match the configured
  origin and path before state is consumed. Concurrent reuse yields exactly one
  completion; provider failure burns the attempt and exposes only a stable
  error code/message.
- A temporary Bun/Drizzle SQLite feasibility adapter persists only the typed
  Operator Identity projection and opaque Operator Session fields. Complete
  snapshots contain no provider-token/raw-claim columns or values. Injected
  failures after identity and session writes roll back to zero rows; identity
  keying, profile pruning, idempotent revocation, and five/100 session caps also
  pass. The production `/data/admin.sqlite` schema and the same contract remain
  #24 work.
- Callback-time provider outage after successful discovery runs alongside the
  real Bun Matrix endpoint and public `/health`; Matrix returns its canonical
  success, FCM delivery occurs once, health remains `200`, and the isolated
  auth store remains empty.
- `pnpm nx run push-gateway:check-auth-selection` bundles the retained module at
  53,722 raw/17,206 gzip bytes from 15 source inputs. It requires exactly
  `openid-client@6.8.7`, keeps `oidc-provider@9.11.3` development-only, and
  rejects every Better Auth package. It also inspects all 108 inputs in the
  production Bun metafile and rejects losing or test-only code there.
- `pnpm nx run push-gateway:check-bundle` reports the unchanged Worker at
  302,263 raw/62,570 gzip bytes, 1.99% of the Free-plan gzip limit, with its
  unchanged 103-input graph. The unwired Bun gateway remains 269,812 raw/57,304
  gzip bytes. [Pull-request container CI](https://github.com/quwisky/trinity-push-gateway/actions/runs/33350917007)
  reports 163,202,149 unpacked and 73,793,454 compressed bytes, 83,492,946
  bytes below the retained 157,286,400-byte compressed ceiling.

## Required implementation shape

With the selected library, keep one narrow OIDC module above `openid-client`;
#24 will put durable behavior in its separate Drizzle/Bun administration layer:

1. Discover the issuer and construct a confidential client using the configured
   secret authentication method. Generate independent state, nonce, and PKCE
   verifier; store the server-side state row with a maximum five-minute expiry.
2. On callback, atomically consume the state before code exchange. Process the
   authorization-code response with the stored verifier, state, and nonce; take
   identity only from validated `iss` and `sub` claims.
3. Validate the configured group claim and membership before any identity or
   session write. Treat name and email as optional mutable projections, never
   lookup/link by email, and never persist or return provider tokens.
4. In #24, use one synchronous Drizzle/Bun transaction to upsert the `(issuer, subject)`
   identity, prune/update optional profile data, enforce both session caps, and
   create an opaque session with idle, absolute, and policy-fingerprint fields.
5. In #24, expose only the fixed login/callback/logout routes plus the separately
   specified session-protected administration routes. Enforce exact Origin,
   the session-bound XSRF cookie/header contract, and strict cookie attributes
   at this boundary.
6. Discover `end_session_endpoint` and have #24 revoke the local session before
   any provider redirect. Do not retain an ID token merely to add an
   `id_token_hint`. The module may construct a best-effort URL with `client_id`,
   but it intentionally omits `post_logout_redirect_uri` because Pocket ID and
   Authentik do not both guarantee that return without a valid ID-token hint.
   The standard permits `client_id` as an OP-recognition parameter but does not
   require every provider to produce the same user experience
   ([spec](https://openid.net/specs/openid-connect-rpinitiated-1_0.html#RPLogout)).

## Reusable deterministic `oidc-provider` contract suite

Use exact [`oidc-provider@9.11.3`](https://github.com/panva/node-oidc-provider/tree/v9.11.3)
in a Node 22-or-newer child, driven by Bun, with deterministic accounts,
ephemeral signing keys, and a loopback listener. The provider explicitly warns
that Bun is unsupported, so it does not run in the Bun test process. Its
documented configuration supports
custom clients, account claims, adapters, PKCE, and discovery
([configuration](https://github.com/panva/node-oidc-provider/blob/main/docs/README.md)).
Run the same suite twice: a Pocket-ID-like `groups` profile and an
Authentik-like scope-mapped groups profile. Keep one thin external smoke test
per real provider outside the deterministic suite.

The retained suite proves:

- `client_secret_basic` and `client_secret_post`; authorization code only;
  `code_challenge_method=S256`; unique state, nonce, and verifier per attempt.
- Discovery issuer equality, JWKS signature, audience, nonce, and state success;
  deterministic rejection for wrong issuer, wrong or non-exact audience, wrong
  nonce, signature, expired token, and required ID token.
- Exactly one success from concurrent callbacks using the same state, rejection
  after five minutes with a fake clock, replay rejection, and no token-endpoint
  call after a state failure.
- Group claim present with exact membership; missing claim, wrong type, and
  absent membership rejected before any identity/session write.
- Stable identity for the same `(iss, sub)`; separate identities for equal
  emails with different subjects or issuers; successful login without email or
  name; mutable profile update and pruning.
- Token response values absent from the returned identity, database snapshots,
  and thrown errors after both success and injected failure.
- 30-minute idle and eight-hour absolute boundaries with a fake clock; policy
  fingerprint invalidation; immediate rejection after a feasibility revocation
  write; deterministic oldest eviction at five per identity and 100 globally.
- Strict host-only session-cookie policy values plus exact-origin and
  session-bound XSRF decisions. Same-session XSRF reuse remains valid because
  the accepted contract is session-bound, not one-use.
- Token-free best-effort provider-logout URL construction and the required
  local-first revocation contract; #24 must compose the logout route and real
  provider behavior. No portable post-logout return is claimed.
- Fault injection after identity and session writes: the complete feasibility
  transaction either commits or rolls back.
- Callback-time provider outage after discovery cannot alter Matrix
  notification delivery or health behavior; #24 must prove startup/discovery
  and administration-database failure isolation in the production composition.
- Bun build/import smoke, selected/application bundle budgets, the
  pull-request compressed-image guard, and a Worker source-map assertion
  showing no `openid-client`, `oauth4webapi`, or Bun administration module in
  the Worker graph and no unexplained Worker bundle delta. Existing Worker
  `jose` inputs remain valid for FCM signing.

The same contract is designed for extension rather than replacement. #24 must
add production-adapter cases for key rotation, missing/malformed callback
parameters, concurrent database writers, fault injection after profile and cap
eviction writes, audit rollback, fixed path/method allowlisting, cookie
serialization, cross-session/post-revocation XSRF, and HTTP/log/header leakage.

## Remaining unknowns before delivery

The selection and its route-free protocol/session-policy seam are complete.
The remaining production integration belongs to #24: current Pocket ID and
Authentik product smoke with documented client/group mappings, the real
`admin.sqlite` adapter under the retained contracts, fixed-route/cookie
composition, and the wired Bun image delta. None of those deferred integration
checks favors Better Auth; it already has several source-proven mandatory
failures and is excluded by the dependency/bundle guards.
