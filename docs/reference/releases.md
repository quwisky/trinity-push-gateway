# Releases and documentation versions

Release Please derives semantic versions from Conventional Commits. A stable
release exists only after its generated release pull request passes CI and is
squash-merged.

Documentation has three channel forms:

- **Latest** is the newest stable release.
- **Next** follows reviewed changes merged to `master` and may describe
  unreleased behavior.
- **vX.Y.Z** is a write-once snapshot built from that immutable release tag.

Use a stable version when operating production. Historical versions remain
available for existing deployments, but corrections land in a new release.

Container images are published for AMD64 and ARM64 under immutable version tags
and a moving `latest` convenience tag. Production deployments should pin a
version or digest.
