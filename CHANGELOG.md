# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Matrix Push Gateway API endpoint for Trinity's Android and iOS app IDs.
- Privacy-preserving FCM HTTP v1 delivery using native Web Crypto and no runtime dependencies.
- D1-backed event deduplication, daily delivery budget, and scheduled cleanup.
- Request-size, device-count, source-rate, and FCM-concurrency safeguards for Cloudflare's free tier.
- Strict validation, private platform payloads, structured redacted logs, and configuration readiness checks.
- Integration tests, bundle-size guard, immutable-pinned CI, deployment guide, client contract, and architecture decisions.

[Unreleased]: https://github.com/quwisky/trinity-push-gateway/commits/main
