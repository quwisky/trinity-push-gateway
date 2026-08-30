# Issue tracker: GitHub

Issues and specifications for this repository live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- Create an issue with `gh issue create`.
- Read an issue with `gh issue view <number> --comments`, including its labels.
- List issues with `gh issue list`, using JSON output and appropriate state or label filters.
- Comment with `gh issue comment`.
- Add or remove labels with `gh issue edit`.
- Close issues with `gh issue close`.

Infer the repository from the Git remote. When a skill says to publish to the issue tracker, create a GitHub issue. When it says to fetch a ticket, read the corresponding GitHub issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Set this to `yes` if external pull requests should appear in general triage discovery. Explicitly named pull requests may still be inspected directly.

GitHub issues and pull requests share one number space. Resolve an ambiguous reference by checking for a pull request first, then an issue.

## Wayfinding operations

A wayfinding map is one issue labelled `wayfinder:map`, with child issues representing research, prototypes, grilling, or implementation tasks.

- Prefer native GitHub sub-issues.
- Use native issue dependencies for blocking relationships.
- If those features are unavailable, use task lists and `Blocked by:` lines.
- The next frontier item is the first open, unassigned child without an open blocker.
- Claim work by assigning the issue to the current user.
- Resolve work by commenting with the result, closing the child, and adding its context pointer to the map.
