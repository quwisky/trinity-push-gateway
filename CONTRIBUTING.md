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
pnpm nx run push-gateway-ui:check
pnpm nx run push-gateway-docs:check
```

Use Nx targets for project work, for example `pnpm nx run push-gateway:test`, `pnpm nx run push-gateway:build`, `pnpm nx run push-gateway:dev`, `pnpm nx run push-gateway-ui:serve`, `pnpm nx run push-gateway-ui:generate-api`, and `pnpm nx run push-gateway-docs:serve`. The official ESLint plugin infers project-scoped `lint`; Angular's native Vitest builder owns the UI `test` target, while the Nx Vitest plugin infers run-mode tests for the other projects. Wrangler, Bun, VitePress, TypeScript, migration, coverage, generated-client drift, bundle-policy, and aggregate targets remain explicit. Nx uses only its local cache; source generation, deployment, migration, development-server, release, and Docker-daemon operations are never cached.

Pull-request and `master` CI use Nx affected execution. Shared dependencies, workspace configuration, Compose, and CI configuration affect `push-gateway`; documentation changes run `push-gateway-docs:check` while skipping unrelated gateway and container work. After successful `master` CI, the dedicated Pages workflow publishes `/next/` and, for a verified Release Please tag, the write-once release version plus `/latest/`.

## Database migrations

The D1 and Bun adapters share one Drizzle SQLite schema and one reviewed migration lineage. After changing `apps/push-gateway/src/schema.ts`, generate the next migration with an explicit name:

```sh
pnpm nx run push-gateway:generate-migration --name=add_delivery_note
```

The target runs the D1 and Bun generation profiles sequentially and inserts `-- minimum-reader: <previous migration filename>` as the first line. Review the SQL rather than applying it with `drizzle-kit push` or a Drizzle runtime migrator. Keep migrations expand-first, verify the generated minimum-reader metadata, and retain required physical SQLite clauses such as `WITHOUT ROWID` that Drizzle cannot model. Wrangler remains the D1 runner, while Bun keeps its compatibility-aware startup runner. `push-gateway:check-migrations` validates both profiles, the snapshot lineage, the immutable initial migration, and no-op regeneration.

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
