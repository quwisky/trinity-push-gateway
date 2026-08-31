# Issue 26: UI integration constraints

## Decision

Keep the five feature routes as lazy standalone Angular routes and build their
state from Angular signals, the generated `HttpClient` client, and the existing
small `RemoteResource` abstraction. Do not add a client-state, query, chart
wrapper, date, or second form library.

Keep Chart.js and ng-forge out of the initial bundle by importing them only
from routes that use them. The one dependency still needed for the accepted
test contract is exact `@axe-core/playwright@4.13.0` as a development
dependency. Its package brings `axe-core~4.13.0` and accepts
`playwright-core >=1.0.0`, so it is compatible with the repository-pinned
Playwright 1.62.1
([exact package manifest](https://github.com/dequelabs/axe-core-npm/blob/v4.13.0/packages/playwright/package.json)).

The repository pins Angular 22.1.4, `@spartan-ng/brain` 1.3.4, ng-forge 1.1.0,
Chart.js 4.5.1, and Playwright 1.62.1. The package contracts are mutually
compatible: Spartan 1.3.4 accepts Angular/CDK 21 or 22 and marks Brain as
side-effect-free
([manifest](https://github.com/spartan-ng/spartan/blob/v1.3.4/libs/brain/package.json));
ng-forge 1.1.0 requires Angular 22 and is also side-effect-free
([manifest](https://github.com/ng-forge/ng-forge/blob/v1.1.0/packages/dynamic-forms/package.json)).

## Route allocation

| Route         | External integration                      | Constraint                                                                                                                                                 |
| ------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview      | Angular signals and generated API only    | Poll every 30 seconds while visible, preserve stale success, and remain chart-free.                                                                        |
| Metrics       | ng-forge, modular Chart.js, native `Intl` | The range/interval controls are user-entered filters, so they fall under the ng-forge requirement. Poll only a range that includes the current UTC bucket. |
| Operations    | ng-forge, native dialog, Spartan controls | Confirm Firebase validation, cleanup, and backup explicitly; keep action status and cooldown/deadline text in the dialog.                                  |
| Configuration | Angular signals and generated API only    | Render read-only safe values; do not instantiate a form library.                                                                                           |
| Security      | ng-forge, native dialog, Spartan controls | Audit filters are user-entered; session revocation is a confirmed mutation. Keep opaque cursor state outside the form value.                               |

Angular route-level providers are scoped to a route and its children
([route-provider contract](https://angular.dev/guide/routing/define-routes#route-level-providers-for-dependency-injection)).
Therefore, provide the minimal ng-forge adapter independently on Metrics,
Operations, and Security. Do not move it to the shell route: that would make a
large optional integration reachable from the initial navigation. Angular's
`loadComponent` and `loadChildren` split lazy routes into separately requested
chunks
([loading strategy](https://angular.dev/guide/routing/loading-strategies#lazily-loaded-components-and-routes)).

The existing source guard currently treats “route-local” as “Operations-only.”
Issue #26 must update that guard to allow the shared adapter only from the
three form-bearing lazy routes. The accepted requirement is not satisfied by
using ordinary controls for Metrics or Security filters.

## Angular 22 router, signals, and polling

- Keep mutable remote state in writable signals and derive totals, labels,
  disabled states, empty states, and stale banners with `computed()`. In a
  zoneless application, updating a signal read by a template is an Angular
  change-detection notification; `OnPush` is the recommended compatibility
  shape
  ([zoneless requirements](https://angular.dev/guide/zoneless#requirements-for-zoneless-compatibility)).
- Reserve `effect()` for the imperative boundaries: synchronizing a Chart.js
  instance and the local-only theme/time-zone preference. Angular explicitly
  identifies canvas/chart rendering as an appropriate effect use and advises
  `computed()` rather than effects for derived state
  ([effect guidance](https://angular.dev/guide/signals/effect#use-cases-for-effects)).
- Initialize Chart.js after the canvas exists with `afterNextRender`; Angular
  documents this hook for one-time DOM setup of non-Angular libraries
  ([API](https://angular.dev/api/core/afterNextRender)). Destroy the Chart.js
  instance on route-component destruction.
- Subscribe to route/poll observables with `takeUntilDestroyed()` so a lazy
  route stops work when it is left; the operator completes its source when the
  owning component or service is destroyed
  ([API](https://angular.dev/api/core/rxjs-interop/takeUntilDestroyed)).
- Implement the 30-second rule from `Document.hidden` plus
  `visibilitychange`. The platform standard defines both and fires the event
  when document visibility changes
  ([HTML visibility model](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility)).
  An RxJS `switchMap` from visibility to `timer(0, 30_000)` and `NEVER`, with
  `exhaustMap` around the HTTP call, has the right behavior: resume immediately
  on visibility, stop when hidden, and never overlap polls. The resulting
  subscription must call the resource's load method so an error changes a
  previous success to stale rather than replacing its data.
- “Current Metrics” means the selected `to` boundary includes the current UTC
  hour/day bucket. Historical queries should load on filter submission or
  manual retry but should not acquire a timer.
- Use `Intl.DateTimeFormat(undefined, options)` for browser-locale display. An
  omitted `timeZone` uses the host environment's zone; `timeZone: 'UTC'`
  selects the explicit UTC view, and `timeZoneName` provides a visible zone
  label
  ([ECMA-402 DateTimeFormat contract](https://402.ecma-international.org/#sec-properties-of-intl-datetimeformat-instances)).
  This avoids Luxon and a Chart.js time adapter. Keep the wire/query values as
  ISO UTC strings and use a `CategoryScale` with preformatted labels.

## ng-forge 1.1.0 and Spartan 1.3.4

The existing custom adapter follows ng-forge's exact supported seam:
`provideDynamicForm`, a `FieldTypeDefinition` per type, category mappers,
`NgForgeFieldHost`/`NgForgeActionHost`, `[formField]`, and `NgForgeControl`.
The latter is important because it forwards the library's derived
`aria-invalid`, `aria-required`, `aria-describedby`, and metadata to the
canonical native control
([1.1.0 adapter guide](https://github.com/ng-forge/ng-forge/blob/v1.1.0/apps/docs/public/content/building-an-adapter.md)).

Implementation constraints:

- Continue authoring configs as `as const satisfies FormConfig` and validate
  them with the existing Zod Standard Schema wrapper. ng-forge maps Standard
  Schema issue paths to their corresponding Signal Form fields
  ([Zod integration](https://github.com/ng-forge/ng-forge/blob/v1.1.0/apps/docs/public/content/schema-validation/zod.md)).
- The repository patch deliberately removes ng-forge's built-in fields,
  wrappers, containers, addons, and paged-form loader. All issue #26 forms must
  therefore stay flat and use only the registered `input`, `datetime`,
  `select`, `checkbox`, and `submit` types. Do not introduce `row`, `group`,
  `page`, `text`, wrapper, or addon config types.
- Promote the adapter from an Operations-specific path to a shared lazy-feature
  path, but keep providers on the individual form-bearing routes. This shares
  source without making ng-forge an application-root dependency.
- A `datetime-local` value contains no zone. Convert it according to the
  explicitly displayed local/UTC mode before calling the API, validate
  `from < to` and the 30-day bound in Zod, and never pass the raw local string
  as an API timestamp.
- For asynchronous confirmation forms, prefer ng-forge's
  `submission.action`. It supplies a submitting state and disables submit
  buttons while the returned Promise/Observable is pending. The resolved value
  is discarded, and action errors are caught by the library, so the action
  must catch/map server problems into the page's own safe status signal
  ([submission contract](https://github.com/ng-forge/ng-forge/blob/v1.1.0/apps/docs/public/content/dynamic-behavior/submission.md)).
  If manual `(submitted)` handling is retained instead, add an explicit
  pending guard; otherwise rapid submits can duplicate a mutation.

Use app-owned Helm-style wrappers over individual Brain entry points rather
than adding `@spartan-ng/helm` or the Spartan CLI. Brain is already the runtime
dependency; the project's copied wrappers keep styles and imports auditable.

For destructive or bounded operator actions, Spartan's alert-dialog primitive
has the right defaults: it changes the role to `alertdialog` and disables
outside-pointer dismissal
([1.3.4 source](https://github.com/spartan-ng/spartan/blob/v1.3.4/libs/brain/alert-dialog/src/lib/brn-alert-dialog.ts)).
The underlying dialog defaults autofocus the first tabbable control and restore
focus to the trigger
([defaults](https://github.com/spartan-ng/spartan/blob/v1.3.4/libs/brain/dialog/src/lib/brn-dialog-token.ts)).
Still test focus trapping, Escape, trigger restoration, and accessible
title/description explicitly.

Two exact-version pitfalls matter:

1. Alert dialogs still close on Escape unless `disableClose` is set. Disable
   closing only while a mutation is pending; outside-pointer dismissal is
   already disabled.
2. Spartan's Helm `hlmAlertDialogAction` styles the action but does not close
   the dialog, while its cancel directive composes `BrnDialogClose`
   ([action source](https://github.com/spartan-ng/spartan/blob/v1.3.4/libs/helm/alert-dialog/src/lib/hlm-alert-dialog-action.ts),
   [cancel source](https://github.com/spartan-ng/spartan/blob/v1.3.4/libs/helm/alert-dialog/src/lib/hlm-alert-dialog-cancel.ts)).
   Close explicitly through the portal context after a successful action; keep
   the dialog open with a safe problem/status announcement on failure.

The optimized implementation build changed the final selection. Importing the
Brain/CDK dialog stack added 65.8 KiB of minified JavaScript and pushed the
accepted browser output over its 1 MiB hard cap. The delivered confirmation
uses the platform `<dialog role="alertdialog">` primitive, Spartan buttons,
and the shared ng-forge confirmation field instead. It retains modal focus,
Escape cancellation outside a pending mutation, trigger-focus restoration,
explicit success close, and failure-in-place behavior without shipping the CDK
overlay runtime.

## Chart.js 4.5.1, accessibility, and CSP

Import from `chart.js`, never `chart.js/auto`. Chart.js is tree-shakeable only
when the needed controllers, elements, scales, and plugins are explicitly
registered
([bundler integration](https://www.chartjs.org/docs/latest/getting-started/integration.html#bundlers-webpack-rollup-etc)).
The exact set for issue #26 is:

```ts
Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);
```

Use stacked bar datasets for request outcomes and FCM outcomes with
`scales.x.stacked` and `scales.y.stacked`; this is the documented stacked-bar
configuration
([sample](https://www.chartjs.org/docs/latest/samples/bar/stacked.html)).
The approximate p95 series can be a line dataset with its own linear axis.
Chart.js mixed charts set `type` on each dataset, and their chart-type defaults
are not merged at the chart level
([mixed-chart contract](https://www.chartjs.org/docs/latest/charts/mixed.html)).
For a simpler and more legible result, three small charts—request outcomes,
FCM outcomes, and p95 latency—are preferable to one overloaded mixed chart and
use the same registered set.

Set `animation: false` for every chart and use `chart.update('none')` for poll
updates. Chart.js documents both the global animation-off switch and the
no-animation update mode
([animations](https://www.chartjs.org/docs/latest/configuration/animations.html#disabling-animation),
[updates](https://www.chartjs.org/docs/latest/developers/updates.html#preventing-animations)).
Call `destroy()` on component teardown; it releases Chart.js references and
event listeners
([API](https://www.chartjs.org/docs/latest/developers/api.html#destroy)).

A canvas is not a semantic data representation. Chart.js explicitly leaves
canvas accessibility to the author
([accessibility guidance](https://www.chartjs.org/docs/latest/general/accessibility.html)).
Every chart therefore needs an equivalent ordinary table that includes every
UTC bucket and every displayed series, including approximate p95 values. Keep
the table available in all color schemes and forced-colors mode; do not make it
a visually hidden summary. The canvas may have an accessible name, but the
table is the authoritative screen-reader and non-color representation.

The production CSP can remain unchanged. Angular applies the request nonce
from `ngCspNonce` to framework-created style elements
([Angular CSP contract](https://angular.dev/best-practices/security#content-security-policy)).
Chart.js uses canvas and programmatic element styles, while Spartan/CDK overlays
position elements with style attributes; the existing narrow
`style-src-attr 'unsafe-inline'` allowance accommodates these without adding
`unsafe-inline` or `unsafe-eval` to `script-src`. Prove this on the real
nonce-bearing production asset server with `securitypolicyviolation`, console,
page-error, and failed-request assertions; a static-file smoke is not enough.

## Playwright 1.62.1 and axe

Configure four projects:

- Chromium (`Desktop Chrome`): every functional flow, every route/state axe
  scan, CSP, forced-colors, reduced-motion, and proof capture.
- Firefox (`Desktop Firefox`): tagged login, navigation, logout, and keyboard
  smoke.
- WebKit (`Desktop Safari`): the same tagged cross-browser smoke.
- Mobile WebKit (`iPhone 13`): tagged drawer/navigation and responsive route
  smoke.

Playwright's official browser matrix uses `Desktop Safari` for WebKit and an
iPhone device profile for Mobile Safari
([browser projects](https://playwright.dev/docs/browsers#run-tests-on-different-browsers),
[device emulation](https://playwright.dev/docs/emulation#devices)). Use project
`grep` tags so Chromium runs everything while the other projects run only their
accepted subset; project-level filtering is a documented use of `grep`
([TestProject](https://playwright.dev/docs/api/class-testproject#test-project-grep)).

Build an axe fixture with:

```ts
new AxeBuilder({ page }).withTags([
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
]);
```

`AxeBuilder.analyze()` and a shared fixture are the first-party Playwright
recommendation
([guide](https://playwright.dev/docs/accessibility-testing#using-a-test-fixture-for-common-axe-configuration));
axe-core defines `wcag22aa` as its WCAG 2.2 Level AA tag
([tag list](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#axe-core-tags)).
Do not exclude shell, chart, form, or overlay selectors. Scan the complete page
after each meaningful state is visibly settled, including open confirmations,
because CDK overlays are attached outside the route component subtree.

At minimum, the meaningful-state matrix should include initial loading,
success, empty, stale-after-success, and first-load error where applicable;
Metrics populated/table/filtered states; Operations confirmation, pending,
success, problem, cooldown, and backup-list states; and Security current/other
sessions, revocation confirmation, audit filter, and next-page states.

Axe does not prove WCAG conformance; axe-core reports that automated rules find
only a portion of accessibility defects and can return incomplete results that
need manual review
([scope statement](https://github.com/dequelabs/axe-core#the-accessibility-rules)).
Retain explicit keyboard/focus assertions and record the accepted manual 200%
zoom and screen-reader-equivalent table review. Playwright can automate
`forcedColors: 'active'` and `reducedMotion: 'reduce'` through
`page.emulateMedia()`
([API](https://playwright.dev/docs/api/class-page#page-emulate-media)), but a
smaller viewport is not evidence of real 200% browser zoom.

## Implementation checklist

1. Share the patched five-field ng-forge adapter across Metrics, Operations,
   and Security, with one provider per lazy route.
2. Keep Overview and Configuration free of ng-forge/Chart.js; keep Chart.js
   confined to Metrics.
3. Add only exact `@axe-core/playwright@4.13.0` as a new development
   dependency.
4. Register only the nine Chart.js symbols above; retain the existing hard
   initial, per-script, and total raw/gzip/Brotli budgets.
5. Exercise real production CSP with the native modal open and every chart
   rendered before claiming compatibility.
6. Keep screenshots/video/GIF proof in Playwright output or temporary storage
   and upload it directly to the pull request; do not add it to the repository.
