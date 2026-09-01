# Rebase migrations only before the first stable release

Until the first immutable `vX.Y.Z` release exists, the gateway and administration migration lineages are unreleased bootstrap artifacts and may be rebased in place when architecture work changes their canonical schemas. There is no supported database upgrade contract during this pre-release window, so keeping one coherent reviewed bootstrap lineage is preferable to preserving compatibility with disposable development databases.

Every rebase must update the typed schema, reviewed SQL, Drizzle snapshots, and reviewed baseline hashes together, and prior local databases must be recreated. The first stable release ends this exception: every published migration filename and artifact becomes immutable, and all subsequent schema changes must use new expand-first, forward-only migrations that preserve the documented rollback contract.
