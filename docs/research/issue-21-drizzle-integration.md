# Issue 21 Drizzle integration research

Research date: 2026-08-31

Issue: [#21, Adopt Drizzle for the D1 and Bun storage adapters](https://github.com/quwisky/trinity-push-gateway/issues/21)

## Scope and version boundary

This note checks the issue against the published source for exactly:

- [`drizzle-orm` 0.45.2](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/package.json#L1-L4), tag commit [`273c780`](https://github.com/drizzle-team/drizzle-orm/commit/273c78071d4841b497f5144734b38294df7ec64b).
- [`drizzle-kit` 0.31.10](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/package.json#L1-L4), tag commit [`4aa6ecf`](https://github.com/drizzle-team/drizzle-orm/commit/4aa6ecfee4b4728dadf6f77f071a149878a3c6c0).

Current unversioned documentation is used only where it describes the owning platform's contract (Cloudflare D1, Bun, and SQLite). Version-sensitive Drizzle claims below point to the tagged source.

## Conclusion

The issue is feasible without merging the two storage adapters:

1. Define one shared `drizzle-orm/sqlite-core` schema for the two application tables.
2. Wrap the existing D1 binding with `drizzle-orm/d1` and the already-configured `bun:sqlite` `Database` with `drizzle-orm/bun-sqlite`.
3. Move ordinary selects, conditional upserts, updates, and deletes to the shared SQLite query-builder vocabulary.
4. Keep D1 atomic groups as D1 batches and keep Bun's exact immediate-transaction and operational SQL boundaries native/raw, as required by [ADR 0023](../architecture/adr/0023-use-drizzle-within-runtime-specific-storage-adapters.md) and issue #21.
5. Use Drizzle Kit only to generate and validate reviewed artifacts. Keep Wrangler and the existing Bun compatibility runner as the migration executors.

Two limitations need explicit handling: Drizzle cannot model `WITHOUT ROWID`, and Drizzle Kit 0.31.10 does not produce byte-identical metadata in a clean-room regeneration.

## Runtime drivers

### D1

`drizzle-orm/d1` accepts an existing `D1Database`, an optional Drizzle configuration including `schema`, and returns a typed SQLite database with the original binding exposed as `$client`. The database uses the asynchronous SQLite dialect. [Tagged driver source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/d1/driver.ts#L24-L77)

The D1 driver exposes a typed `db.batch([...])`. It accepts a non-empty tuple of unexecuted Drizzle SQLite query objects, prepares and binds each one, calls the native D1 `client.batch(...)` once, and maps each native `D1Result` back to the query's Drizzle result shape in tuple order. [Database batch signature](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/d1/driver.ts#L32-L36) and [session implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/d1/session.ts#L77-L108)

Consequences:

- A select or DML statement with `returning()` is mapped to rows, not left as a raw `D1Result`.
- Code that needs native metadata or a batch item which remains intentionally raw can use `$client` and the native prepared statement API.
- Cloudflare documents `D1Database.batch()` as an ordered SQL transaction which aborts or rolls back the whole sequence on failure, so it remains the required atomic D1 boundary. [Cloudflare D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

Drizzle ORM 0.45.2 also exposes `db.transaction()` for D1, but its implementation sends `BEGIN`, the callback's statements, and `COMMIT` or `ROLLBACK` as separate session calls; nested transactions similarly send savepoint statements. [Tagged D1 transaction implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/d1/session.ts#L111-L145) Cloudflare documents D1 as auto-commit and identifies `batch()` as the transactional multi-statement API. Therefore the Drizzle transaction callback is not a substitute for the issue's explicit D1 batch boundaries. [Cloudflare D1 database contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)

The missing-row sentinel changes at the Drizzle boundary. Native `D1PreparedStatement.first()` returns `null` for no row, while the Drizzle D1 prepared query's `get()` returns `undefined`. [Native D1 `first()`](https://developers.cloudflare.com/d1/worker-api/prepared-statements/#first) and [tagged Drizzle `get()`](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/d1/session.ts#L238-L258)

### Bun SQLite

`drizzle-orm/bun-sqlite` can accept an existing `Database` as `drizzle({ client, schema })` and exposes it as `$client`. Its convenience connection options include `readonly`, `create`, and `readwrite`, but not Bun's `strict` option. The existing adapter should therefore continue constructing and configuring the native `Database` itself, then wrap that instance; otherwise its current strict mode would be lost. [Tagged Bun driver construction and option types](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/driver.ts#L23-L55) and [client overload](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/driver.ts#L85-L142)

The Bun driver is synchronous. It implements `run`, `all`, `get`, and `values`; `get()` returns `undefined` when no row exists. [Tagged Bun prepared-query implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/session.ts#L103-L168) The database-level mutation run result is typed as `void`, so use `returning()` or the native client rather than depending on mutation metadata through the generic Drizzle `run()` type. [Tagged Bun database result kind](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/driver.ts#L17-L21)

Drizzle's Bun transaction wrapper is synchronous and forwards `deferred`, `immediate`, or `exclusive` behavior to the corresponding native Bun transaction wrapper; nested transactions use savepoints. [Tagged Drizzle Bun transaction implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/session.ts#L68-L100) Bun itself documents that `.immediate()` uses `BEGIN IMMEDIATE`. [Bun transaction contract](https://bun.sh/docs/runtime/sqlite#transactions) This proves the capability exists, but issue #21 expressly reserves `BEGIN IMMEDIATE` and compatibility/startup behavior as narrow raw boundaries, so adoption need not move those boundaries into Drizzle.

### Shared raw escape hatch

The base SQLite database also accepts an SQL wrapper or string through `run`, `all`, `get`, and `values`. Strings become `sql.raw(...)`. [Tagged base SQLite raw methods](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/db.ts#L533-L586) For this repository, `$client` is the clearer escape hatch when the native runtime API itself is part of the contract: D1 batches, Bun transaction mode, connection PRAGMAs, backup, integrity checks, and close behavior.

## Canonical SQLite schema

The common application schema can express the existing column types, nullability, primary keys, named check constraints, and expiry index with `sqliteTable`, `text`, `integer`, `check`, and `index`. The table API accepts columns plus extra constraints/indexes; the SQLite snapshot serializer records columns, indexes, foreign keys, primary keys, unique constraints, and checks. [Tagged table API](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/table.ts#L59-L160) and [tagged SQLite snapshot shape](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/serializer/sqliteSchema.ts#L57-L80)

Schema implications:

- Keep `lease_expires_at`, `expires_at`, and `attempts` as ordinary numeric `integer()` columns. Drizzle's timestamp modes map numbers to `Date`; that would change the existing port's seconds-as-number contract. [Tagged integer and timestamp mapping](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/columns/integer.ts#L66-L155)
- `text({ enum: [...] })` narrows TypeScript insert/select types but does not validate runtime values or emit a database enum check. Keep an explicit named `check(...)` for `outcome`, and keep the non-negative attempts check. [Official Drizzle SQLite column documentation](https://orm.drizzle.team/docs/sqlite/column-types#text) and [tagged check builder](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/checks.ts#L1-L35)
- Keep adapter-owned migration bookkeeping out of the shared application schema. D1 owns `d1_migrations`; Bun owns `gateway_migrations` plus `minimum_reader`. They are intentionally different compatibility mechanisms, not one shared table.

Neither the 0.45.2 `sqliteTable` API nor the 0.31.10 SQLite snapshot model has a `WITHOUT ROWID` table attribute. [Tagged table API](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/table.ts#L59-L160) and [tagged snapshot table model](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/serializer/sqliteSchema.ts#L40-L65) Therefore:

- Preserve `apps/push-gateway/migrations/0001_initial.sql` rather than replacing it with freshly generated create-table SQL.
- Manually review/augment any future generated create-table SQL that requires `WITHOUT ROWID`.
- Keep a focused migration/source guard for `WITHOUT ROWID`, because Drizzle snapshot drift detection cannot detect that physical option.

## Query-builder behavior needed by the adapters

### Conditional upsert and claim/reservation results

SQLite insert builders support `.onConflictDoUpdate({ target, set, targetWhere, setWhere })`. The old single `where` option is deprecated; `setWhere` is the update-side predicate and is the direct mapping for both current conditional upserts. [Tagged SQLite insert conflict API](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/insert.ts#L156-L164) and [SQL construction](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/insert.ts#L319-L365)

The tagged source itself still carries a TODO to add coverage for `targetWhere` and `setWhere`, so the repository's adapter parity tests should directly prove both the generated predicate and the no-update result. [Tagged conflict-option source](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/insert.ts#L156-L164)

Values in `.values()` and `.set()` are parameterized; a small `sql` fragment is still needed where the SQL `excluded` pseudo-table is semantically important, such as `attempts + excluded.attempts`. The official upsert examples use `sql\`excluded.name\`` for this case. [Drizzle insert/upsert documentation](https://orm.drizzle.team/docs/insert#upserts-and-conflicts)

SQLite supports `RETURNING` for insert, update, and delete, and reports inserted or updated rows from an upsert. [SQLite `RETURNING` contract](https://www.sqlite.org/lang_returning.html) Drizzle's SQLite insert builder supports full or partial `.returning(...)`, followed by `all()`, `get()`, or normal awaited execution. [Tagged SQLite returning API](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/insert.ts#L253-L282) and [execution methods](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/insert.ts#L378-L415)

Use a returned-row array for claim/reservation decisions:

```ts
const [acquired] = await db
  .insert(deliveryRecords)
  .values(/* ... */)
  .onConflictDoUpdate({
    target: deliveryRecords.fingerprint,
    set: /* ... */,
    setWhere: /* lease-expiry predicate */,
  })
  .returning({ fingerprint: deliveryRecords.fingerprint });

const didAcquire = acquired !== undefined;
```

This avoids two edge cases in 0.45.2:

- Both D1 and Bun return `undefined` from prepared `get()` when no row is returned. [D1 implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/d1/session.ts#L238-L258) and [Bun implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/session.ts#L143-L162)
- The SQLite DML prepared-query type declares `get` as the returned row type, without `undefined`, even though the runtime can return `undefined` for a conditional upsert that modifies no row. [Tagged insert prepared-query type](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/insert.ts#L176-L187)

`$returningId()` is not a SQLite insert API. In 0.45.2 it is implemented on the MySQL and SingleStore builders, while the SQLite builder exposes native SQLite `returning()`. [Tagged MySQL `$returningId()` implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/mysql-core/query-builders/insert.ts#L281-L294), [tagged SingleStore implementation](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/singlestore-core/query-builders/insert.ts#L254-L267), and [tagged SQLite insert API](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/insert.ts#L253-L365)

### Select, update, and delete

- `db.select({...}).from(table).where(...)` infers row nullability and selected fields. A prepared select's `get()` type correctly includes `undefined`; add `limit(1)` when only one row is wanted. [Tagged select filtering](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/select.ts#L584-L626) and [prepared select result types](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/select.types.ts#L257-L267)
- `db.update(table).set(...).where(...)` supports partial/full `returning()`. Omitting `where()` updates every row, so every adapter update should retain an explicit predicate. [Tagged update API](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/update.ts#L311-L410)
- `db.delete(table).where(...)` supports partial/full `returning()`. Omitting `where()` deletes every row, so cleanup and release operations must keep explicit predicates. [Tagged delete API](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/query-builders/delete.ts#L159-L253)

For D1 cleanup/readiness groups, pass the unexecuted builders directly to `db.batch([...])`. The returned tuple contains mapped row/run results. Retain native `$client.batch(...)` only where the native `D1Result` shape or deliberately raw statements are part of the behavior being proved.

## Drizzle Kit configuration and artifact lineage

### What the two configurations should mean

Drizzle Kit supports multiple configuration files selected with `--config`. [Official multiple-config documentation](https://orm.drizzle.team/docs/drizzle-kit-generate#multiple-configuration-files-in-one-project) For `generate`, 0.31.10 consumes `dialect`, `schema`, `out`, `breakpoints`, migration `prefix`, `casing`, and a small driver-derived bundling flag; it does not require or consume database credentials. [Tagged `GenerateConfig` and parser](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/utils.ts#L150-L216)

Accordingly, the D1 and Bun files should be offline generation profiles with:

- `dialect: 'sqlite'` in both;
- the same canonical schema path;
- the same canonical migration `out` directory;
- identical `casing`, `breakpoints`, and `migrations.prefix` values;
- no production credentials.

`driver: 'd1-http'` is needed for Drizzle Kit commands that connect to D1, not for SQLite SQL generation. Since this repository must not use Kit to apply schema, omitting connection credentials keeps the configurations generation-only. Drizzle Kit `push` explicitly introspects a live database and immediately applies its generated differences, which conflicts with reviewed SQL and the retained runners. [Official `push` behavior](https://orm.drizzle.team/docs/drizzle-kit-push)

Both configurations must share one `out` directory to represent one migration/snapshot lineage. Separate output directories would create two independent histories with different metadata. Generation should be sequential: 0.31.10 reads the journal, computes the next index, and writes it later without a locking protocol, so two concurrent generators sharing an output directory can race. This is an inference from the tagged [journal read path](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/utils.ts#L96-L112) and [artifact write path](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/migrate.ts#L1394-L1439).

### Existing `0001_initial.sql` needs an adopted baseline snapshot

`generate` reads the latest committed snapshot and compares it with the current schema. If no metadata directory exists, 0.31.10 creates an empty journal and treats the previous SQLite schema as empty. [Tagged output-folder preparation](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/utils.ts#L96-L112), [empty SQLite snapshot](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/serializer/sqliteSchema.ts#L332-L344), and [generation flow](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/migrate.ts#L802-L859)

Therefore merely adding a schema/config beside the existing raw migration would generate a second create-table migration. `--custom` is not a baseline-adoption switch: the custom path writes a new snapshot whose schema body is copied from the previous snapshot, not the current declared schema. [Tagged custom snapshot construction](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/migrationPreparator.ts#L137-L168) and [custom generation branch](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/migrate.ts#L817-L832)

Bootstrap implication:

1. Generate the initial logical SQLite snapshot in an isolated temporary output using the exact pinned versions.
2. Keep the repository's `0001_initial.sql` content and identifier unchanged.
3. Adopt the generated snapshot and journal as the baseline lineage, reconciling their tag/index with `0001_initial` in a deterministic script or reviewed one-time step.
4. Prove the result with `drizzle-kit check` and a clean no-op `generate` from each configuration before committing it.

This one-time adoption should be covered by a test/guard because Drizzle Kit 0.31.10 has no first-class `generate --baseline-existing-sql` option in its tagged generate CLI options. [Tagged generate CLI options](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/schema.ts#L50-L80)

### Determinism and drift detection

Clean-room generation is not byte-deterministic in 0.31.10:

- every new SQLite snapshot gets `crypto.randomUUID()`; [tagged snapshot preparation](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/migrationPreparator.ts#L137-L168)
- an omitted migration name gets a random adjective/hero suffix, while timestamp/unix prefix modes use the wall clock; [tagged migration naming](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/utils/words.ts#L3-L23)
- each journal entry writes `when: +new Date()`. [Tagged artifact writer](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/migrate.ts#L1429-L1439)

Use `migrations.prefix: 'index'` and require the repository wrapper to assign an explicit name for real migrations, but recognize that UUID and journal time still vary. Drizzle Kit 0.31.10 rejects combining `--config` with generation flags such as `--name` or `--out`, so the wrapper must invoke each named config on its own, then safely normalize the generated SQL filename and matching journal tag. In this tool version, the useful deterministic invariant is: **the committed snapshot lineage plus an unchanged schema must make generation a no-op**. When the SQL diff is empty, the writer returns before it persists the newly-created in-memory UUID or time. [Tagged no-change branch](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/migrate.ts#L1385-L1391)

A CI drift target should therefore:

1. Run `drizzle-kit check` on the canonical output to reject malformed, outdated, or colliding snapshot history. The check validates history shape; it does not compare the TypeScript schema with the latest snapshot. [Tagged check implementation](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/check.ts#L4-L50)
2. Run `generate --config=<d1>` and the Bun equivalent sequentially against temporary copies of the committed lineage, using the shared config's check-only output override rather than mixing config and CLI flags.
3. Require the no-schema-change outcome and verify that no tracked or untracked artifact changed.
4. Verify that the two configs have identical generation-relevant fields, so one runtime profile cannot silently fork the SQL.

Do not trust the `generate` process exit code alone for this check. The SQLite generation function catches and logs exceptions without rethrowing them at that point, so the wrapper should fail on generator errors/stderr as well as artifact drift. [Tagged SQLite generator error path](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/migrate.ts#L802-L862)

If acceptance requires byte-for-byte clean-room reproduction rather than stable no-op regeneration, a repository wrapper must additionally normalize or deterministically replace snapshot `id`, `prevId`, journal `when`, and the migration name before comparison. Drizzle Kit 0.31.10 does not provide such normalization.

## Migration runners and raw boundaries

Do not use the runtime Drizzle migrators:

- The D1 migrator reads Drizzle Kit `_journal.json`, creates `__drizzle_migrations` by default with `hash` and `created_at`, and submits statements through its own batch. [Tagged D1 migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/d1/migrator.ts#L6-L48)
- The Bun migrator delegates to the synchronous SQLite dialect, which uses the same hash/time bookkeeping and a plain `BEGIN`, not this repository's `BEGIN IMMEDIATE` plus migration name/minimum-reader contract. [Tagged Bun migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/bun-sqlite/migrator.ts#L5-L10) and [tagged synchronous SQLite migrator](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/sqlite-core/dialect.ts#L936-L995)
- Drizzle's migration reader recognizes journal time, SQL hash, and statement breakpoints; it has no `minimum_reader` concept. [Tagged migration metadata reader](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/drizzle-orm/src/migrator.ts#L9-L59)

Wrangler should continue applying D1 migrations. Cloudflare records versioned SQL filenames sequentially in `d1_migrations`, and `wrangler d1 migrations apply` rolls back a failing migration while retaining earlier successful migrations. [D1 migrations reference](https://developers.cloudflare.com/d1/reference/migrations/) and [Wrangler apply contract](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-apply)

The custom Bun runner should continue owning:

- ordered filename identifiers;
- `minimum-reader` metadata and immediate-predecessor compatibility;
- `BEGIN IMMEDIATE` application;
- startup validation and rollback behavior.

Generated SQL remains an input to review, not the complete migration contract. Preserve/add the `minimum-reader` header as required, verify expand-first compatibility, and manually retain `WITHOUT ROWID` where applicable. Drizzle Kit's default statement-breakpoint marker is controlled by `breakpoints`; use the same explicit setting in both configs. [Tagged breakpoint default and generation config](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/utils.ts#L169-L216) and [tagged SQL writer](https://github.com/drizzle-team/drizzle-orm/blob/drizzle-kit%400.31.10/drizzle-kit/src/cli/commands/migrate.ts#L1354-L1439)

Keep these operations narrow and raw/native, matching issue #21:

- connection PRAGMAs;
- Bun `BEGIN IMMEDIATE`, commit, rollback, and savepoint-sensitive startup/migration work;
- D1 batch boundaries where atomic grouping is the contract;
- migration and compatibility inspection, including adapter-owned metadata tables;
- `pragma_table_info`, `sqlite_master`, and schema/readiness inspection;
- `VACUUM INTO`, integrity checks, and backup lifecycle;
- physical `WITHOUT ROWID` DDL.

## Implementation-ready implications

- Share table definitions and query helpers, not a database instance or transaction abstraction.
- Wrap the existing native clients so Bun strict/configuration/backup behavior and the D1 binding survive unchanged.
- Convert claim and budget reservation to `onConflictDoUpdate(...setWhere...).returning(...)`, and decide success from the returned array's first row.
- Do not use `$returningId()` and do not retain `!== null` checks at Drizzle `get()` boundaries.
- Use typed `select`, `update`, and `delete` for ordinary single statements; retain explicit predicates.
- Use Drizzle `db.batch` only when its mapped results are desired; use D1 `$client.batch` when native result metadata/raw items are required.
- Keep `0001_initial.sql`, Wrangler migration execution, the Bun compatibility runner, and every listed raw boundary.
- Point both offline Kit configs at one schema and one output lineage, and serialize generation.
- Adopt one reviewed baseline snapshot for the existing migration; then gate snapshot validity plus no-op regeneration from both configs.
- Treat `WITHOUT ROWID` and `minimum-reader` as repository-level guards outside Drizzle's schema model.
- Run adapter parity/concurrency/rollback tests and the repository's required Nx checks after implementation; generation success alone cannot prove the runtime contracts.
