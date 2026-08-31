## Agent skills

### Issue tracker

Issues are tracked in this repository's GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical state labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain-document layout. See `docs/agents/domain.md`.

## Workspace

- `apps/push-gateway` is the `push-gateway` Nx application. It contains both the Cloudflare Worker and Bun adapters, their tests, migrations, runtime configuration, bundle guard, and Dockerfile.
- `apps/push-gateway-ui` is the `push-gateway-ui` Angular application for the self-hosted Bun administration surface. Its generated API client follows `apps/push-gateway/openapi/admin-v1.yaml`; administration capabilities are added only through their dedicated tasks.
- Dependencies and release versions are owned by the root `package.json`; internal gateway imports remain relative.
- Use Nx targets such as `pnpm nx run push-gateway:test`. ESLint and run-mode Vitest targets are inferred by official Nx plugins; runtime-specific targets remain explicit. Before delivery, run `pnpm nx format:check --all`, `pnpm nx run push-gateway:check`, `pnpm nx run push-gateway:check-bun`, `pnpm nx run push-gateway-ui:check`, and `pnpm nx run push-gateway-docs:check`.
