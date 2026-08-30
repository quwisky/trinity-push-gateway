## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical state labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-document layout. See `docs/agents/domain.md`.

## Workspace

- `apps/push-gateway` is the `push-gateway` Nx application. It contains both the Cloudflare Worker and Bun adapters, their tests, migrations, runtime configuration, bundle guard, and Dockerfile.
- `apps/push-gateway-ui` reserves the future `push-gateway-ui` Angular application. Do not add UI code, Angular dependencies, project metadata, an administration API, or authentication design without a dedicated task.
- Dependencies and release versions are owned by the root `package.json`; internal gateway imports remain relative.
- Use explicit Nx targets such as `pnpm nx run push-gateway:test`. Before delivery, run `pnpm nx format:check --all`, `pnpm nx run push-gateway:check`, and `pnpm nx run push-gateway:check-bun`.
