# Use Drizzle within runtime-specific storage adapters

The D1 and Bun SQLite adapters will use Drizzle for typed schema and query construction while retaining reviewed SQL wherever exact transaction, migration, atomic-claim, PRAGMA, or runtime API behavior is clearer and safer at the lower level. One canonical set of reviewed SQL migrations continues to feed both runtimes, and the adapters remain separate implementations of the same behavioral ports and contract suite rather than one emulated database layer.

This decision supersedes ADR 0017's blanket ORM exclusion. Its behavioral-port boundary, runtime-specific adapters, shared concurrency and failure semantics, canonical migration lineage, explicit transaction and migration behavior, and justified raw SQL exceptions remain in force.
