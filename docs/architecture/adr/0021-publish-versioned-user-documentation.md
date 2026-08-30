# Publish versioned user documentation with VitePress and GitHub Pages

User and operator documentation is authored as canonical Markdown under
`docs/`, built by the `push-gateway-docs` Nx project with stable VitePress, and
published at the repository's GitHub project Pages URL. The site uses local
search and assets without analytics or other third-party browser requests.

The `/next/` channel follows validated `master` commits. `/latest/` follows the
newest stable release, while `/vX.Y.Z/` is generated once from the corresponding
verified Release Please tag and never overwritten. Generated output is retained
on an orphan `pages-history` branch, but GitHub Actions remains the Pages
publishing source. Build, history assembly, and deployment use separate
least-privilege jobs, and concurrent publications are serialized.

This preserves exact historical output without duplicating authored Markdown,
rebuilding every old tag, or trusting a community versioning plugin. Internal
agent documentation stays unpublished, and all Trinity client implementation
remains outside this repository.
