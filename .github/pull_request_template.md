<!-- Keep this concise. Use a Conventional Commit title: PRs are squash-merged, so the
title becomes the commit release-please reads (the PR title check enforces it). Never
include pushkeys, access tokens, service-account keys or Matrix IDs from real users. -->

## Change

<!-- What changes for operators, homeservers or the Trinity client, and why? Include
design details only when they help a reviewer understand a non-obvious approach. -->

## Related issue

<!-- Use Closes #123 only when this PR resolves the issue; use Refs #123 for partial
or related work. Write "None" if there is no issue. -->

## Validation

<!-- What did you actually check, and what happened? Give the commands and outcomes,
e.g. `pnpm exec nx run-many -t lint typecheck test build`, and `pnpm smoke` against a
deployed instance for delivery changes. State skipped checks and why. Unit tests run
in the Workers runtime but cannot prove real FCM delivery. -->

## Notes

<!-- Optional: configuration or secret changes operators must make (APPS, wrangler.jsonc
bindings, Cloudflare or GitHub secrets), changes to which FCM responses reject a pushkey,
changes to what is logged, and anything needing particular review. Delete if empty. -->
