# Release as an Apache-licensed service

The standalone gateway will use Apache-2.0, semantic versions, a Keep a Changelog `Unreleased` section, and immutable `vX.Y.Z` release tags. This makes the small Matrix infrastructure component straightforward to reuse while keeping its release lifecycle independent from the currently unlicensed Trinity client. ADR 0014 supersedes the hand-maintained `Unreleased` requirement with a generated, reviewed release pull request; the licensing, versioning, and immutable-tag decisions remain accepted.
