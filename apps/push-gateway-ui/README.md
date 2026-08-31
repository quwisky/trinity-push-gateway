# Push Gateway UI

`push-gateway-ui` is the isolated Angular interface for Gateway Operators of a
self-hosted Trinity Push Gateway. It is a strict, standalone, zoneless,
client-rendered application built for the `/admin/` base path.

The project currently supplies the accessible shell and reusable browser
foundations. Bun does not serve or enable the application yet. The Cloudflare
Worker never contains or exposes this operator surface.

## Local commands

Run project work through Nx:

```sh
pnpm nx run push-gateway-ui:serve
pnpm nx run push-gateway-ui:test
pnpm nx run push-gateway-ui:test-coverage
pnpm nx run push-gateway-ui:build
pnpm nx run push-gateway-ui:check
```

The production build emits hashed browser assets under
`dist/apps/push-gateway-ui/browser`. `check` runs inferred ESLint, strict
TypeScript checks, Angular-native Vitest coverage, generated-client drift,
source policy, and raw/compressed browser bundle policy.

## Generated operator API client

The published API contract is `apps/push-gateway/openapi/admin-v1.yaml`.
Runtime-neutral administration schemas migrate into
`apps/push-gateway/src/admin-contract` one capability at a time. The Operator
Session, Operator Session list, and safe configuration schemas own Bun response
validation and generate their marked OpenAPI components; the remaining OpenAPI
components stay directly authored during the compatibility migration. Legacy
validators are parity-test-only and are not used by a runtime route.

Regenerate the canonical administration component before regenerating its
Angular HttpClient client:

```sh
pnpm nx run push-gateway:generate-admin-contract
pnpm nx run push-gateway-ui:generate-api
pnpm nx run push-gateway:check-admin-contract
pnpm nx run push-gateway-ui:check-api
```

Generated files under `src/app/api/generated` are committed, deterministic,
and never edited by hand. The drift check regenerates twice in temporary Nx
workspace data, validates the owned output set, and compares content hashes.

The read-only Configuration route consumes the catalog-backed safe projection
through the same canonical response contract that generates its client type.
It presents only non-secret effective values, configured presence, and direct
or file source; secret values, raw environment names, and credential file paths
never enter the browser contract. Disabled administration returns before either
administration secret source is read.

## Browser boundary

- Chart.js is registered directly and remains on the lazy Metrics route. The
  project does not use `chart.js/auto`, a chart wrapper, or a date adapter.
- The app-owned Spartan/ng-forge adapter registers only text, datetime, select,
  checkbox, and submit fields on the lazy Operations route. Its app-owned Helm
  controls use the minimal Vega style recipes needed from Spartan v1.3.4. The
  route-owned provider deliberately excludes ng-forge's unused built-in fields,
  wrappers, and addons from the browser graph. A pinned pnpm compatibility patch
  disables those unconditional 1.1.0 defaults until ng-forge offers a supported
  provider opt-out; the source and bundle guards verify the patch boundary.
  Paged, container, wrapper, and addon configurations are intentionally outside
  this foundation's supported form surface.
- Theme initialization applies the saved or system light/dark preference before
  any public or protected route renders.
- Production source maps, service workers, manifests, analytics, icon fonts,
  remote browser assets, and Angular sanitizer bypasses are forbidden.
- Visual proof belongs in ignored `test-output/` storage and is uploaded to the
  pull request; proof artifacts are never committed.
