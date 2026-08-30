# Contributing

## Local checks

Install Node 24, Bun 1.4.0, and dependencies with `pnpm install --frozen-lockfile`. Husky then enables two local safeguards:

- `pre-commit` runs the uncached Nx lint fixer for staged gateway source, then Prettier, followed by the full typecheck and test suite.
- `commit-msg` validates the commit message with Commitlint.

Run the complete repository gate before opening a pull request:

```sh
pnpm nx format:check --all
pnpm nx run push-gateway:check
pnpm nx run push-gateway:check-bun
```

Use Nx targets for project work, for example `pnpm nx run push-gateway:test`, `pnpm nx run push-gateway:build`, and `pnpm nx run push-gateway:dev`. The official ESLint and Vitest plugins infer the project-scoped `lint` and run-mode `test` targets; Wrangler, Bun, TypeScript, migration, coverage, bundle-policy, and aggregate targets remain explicit. Nx uses only its local cache; deployment, migration, development-server, release, and Docker-daemon operations are never cached.

Pull-request and `master` CI use Nx affected execution. Shared dependencies, workspace configuration, Compose, and CI configuration affect `push-gateway`; documentation-only and future UI-placeholder changes keep the required checks visible but skip unrelated gateway and container work.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit and pull-request title. CI validates both the title and every commit in the pull request. Common release-relevant prefixes are:

- `feat:` for a minor release
- `fix:` for a patch release
- `feat!:` or a `BREAKING CHANGE:` footer for a breaking change; before `1.0.0`, this remains a minor release
- `chore:`, `build:`, `docs:`, and `test:` for non-releasing maintenance

The repository uses squash-only merging, and the validated pull-request title becomes the commit subject on `master`.

Dependabot groups npm updates under the short `runtime` and `dev` names. Keep these names concise because Dependabot includes the group name in generated pull-request titles, which must stay within Commitlint's 100-character limit.

TypeScript major updates are deferred in Dependabot while `typescript-eslint` does not support the next compiler major. Remove that ignore rule once the lint toolchain supports the upgrade, then validate the complete repository gate before merging it.

Do not edit `CHANGELOG.md` in an ordinary pull request. Release Please creates or refreshes one release pull request after successful `master` CI, and that generated pull request owns the version bump and changelog entry. `CHANGELOG.md` and `.release-please-manifest.json` are intentionally excluded from Prettier so its generated output remains unchanged. Merging the release pull request creates an immutable `vX.Y.Z` tag and GitHub Release; it does not publish to npm or deploy the Worker.
