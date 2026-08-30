# Contributing

## Local checks

Install dependencies with `pnpm install --frozen-lockfile`. Husky then enables two local safeguards:

- `pre-commit` runs ESLint and Prettier on staged files, followed by the full typecheck and test suite.
- `commit-msg` validates the commit message with Commitlint.

Run the complete repository gate before opening a pull request:

```sh
pnpm check
```

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
