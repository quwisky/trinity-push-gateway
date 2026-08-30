# Security Policy

## Supported versions

Security fixes are applied to the latest release. Before the first release, they are applied to `master`.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub's private vulnerability reporting](https://github.com/quwisky/trinity-push-gateway/security/advisories/new). Do not include Push Keys, Firebase credentials, access tokens, private Matrix events, or production logs in a public issue.

Include the affected version or commit, impact, reproduction steps, and a minimal redacted example. You can expect an initial acknowledgement within seven days.

## Security boundaries

The Matrix notification endpoint is intentionally public so arbitrary homeservers can reach it. The gateway relies on strict validation, fixed app IDs, bounded requests, rate controls, a global delivery budget, private payloads, and Cloudflare/Firebase secret bindings. See [the design](docs/DESIGN.md) for the complete threat and privacy model.

Release automation uses a repository-scoped `RELEASE_PLEASE_TOKEN` with only Contents, Issues, and Pull requests write access. It cannot deploy the Worker or publish to npm and must be rotated before expiry.
