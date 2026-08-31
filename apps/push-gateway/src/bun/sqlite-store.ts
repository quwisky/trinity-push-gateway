import { Database } from 'bun:sqlite';
import { and, eq, lt, lte, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { existsSync, rmSync } from 'node:fs';

import { fingerprintFor } from '../fingerprint';
import type { DeliveryClaim, DeliveryIdentity, GatewayStore } from '../ports';
import {
  BUDGET_COLUMNS,
  dailyBudgets,
  DELIVERY_COLUMNS,
  DELIVERY_EXPIRY_INDEX,
  deliveryRecords,
  gatewaySchema,
  type GatewaySchema,
  HEALTH_CHECK_DATE,
} from '../schema';

export type SqlMigration = {
  readonly minimumReader?: string;
  readonly name: string;
  readonly sql: string;
};

type AppliedMigration = {
  readonly minimum_reader: string;
  readonly name: string;
};

function configure(database: Database): void {
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA synchronous = FULL');
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA busy_timeout = 5000');
}

function applyMigrations(
  database: Database,
  migrations: readonly SqlMigration[],
): void {
  database.run(`CREATE TABLE IF NOT EXISTS gateway_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL,
    minimum_reader TEXT NOT NULL
  ) WITHOUT ROWID`);
  const applied = database
    .query<AppliedMigration, []>(
      `SELECT name, minimum_reader
       FROM gateway_migrations
       ORDER BY name`,
    )
    .all();
  const expected = migrations.map(({ name }) => name).sort();
  const incompatible = applied.filter(
    ({ name, minimum_reader }) =>
      !expected.includes(name) && !expected.includes(minimum_reader),
  );
  if (incompatible.length > 0) {
    throw new Error(
      `Database schema is newer than this gateway: ${incompatible
        .map(({ name }) => name)
        .join(', ')}`,
    );
  }

  database.run('BEGIN IMMEDIATE');
  try {
    for (const migration of [...migrations].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (!applied.some(({ name }) => name === migration.name)) {
        const minimumReader = migration.minimumReader ?? migration.name;
        if (!expected.includes(minimumReader)) {
          throw new Error(
            `Migration ${migration.name} names an unknown minimum reader: ${minimumReader}`,
          );
        }
        database.run(migration.sql);
        database
          .query(
            `INSERT INTO gateway_migrations
               (name, applied_at, minimum_reader)
             VALUES (?1, ?2, ?3)`,
          )
          .run(migration.name, new Date().toISOString(), minimumReader);
      }
    }
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

function assertIntegrity(database: Database): void {
  const integrity = database
    .query<{ readonly integrity_check: string }, []>('PRAGMA integrity_check')
    .get();
  if (integrity?.integrity_check !== 'ok') {
    throw new Error('Database integrity check failed.');
  }
}

export class SqliteGatewayStore implements GatewayStore {
  private readonly queryDatabase: BunSQLiteDatabase<GatewaySchema>;

  private constructor(
    private readonly database: Database,
    private readonly expectedMigrations: readonly string[],
  ) {
    this.queryDatabase = drizzle(database, { schema: gatewaySchema });
  }

  static open(
    databasePath: string,
    migrations: readonly SqlMigration[],
  ): SqliteGatewayStore {
    const database = new Database(databasePath, { create: true, strict: true });
    try {
      configure(database);
      applyMigrations(database, migrations);
      assertIntegrity(database);
      return new SqliteGatewayStore(
        database,
        migrations.map(({ name }) => name).sort(),
      );
    } catch (error) {
      database.close(true);
      throw error;
    }
  }

  static openReadOnly(databasePath: string): SqliteGatewayStore {
    return new SqliteGatewayStore(
      new Database(databasePath, { readonly: true, strict: true }),
      [],
    );
  }

  backup(targetPath: string): void {
    if (existsSync(targetPath)) {
      throw new Error(`Backup target already exists: ${targetPath}`);
    }
    try {
      this.database.query('VACUUM INTO ?1').run(targetPath);
      const backup = SqliteGatewayStore.openReadOnly(targetPath);
      try {
        const integrity = backup.database
          .query<{ readonly integrity_check: string }, []>(
            'PRAGMA integrity_check',
          )
          .get();
        if (integrity?.integrity_check !== 'ok') {
          throw new Error('Backup integrity check failed.');
        }
      } finally {
        backup.close();
      }
    } catch (error) {
      rmSync(targetPath, { force: true });
      throw error;
    }
  }

  async claimDelivery(
    identity: DeliveryIdentity,
    fingerprintKey: string,
    nowSeconds: number,
    leaseSeconds: number,
  ): Promise<DeliveryClaim> {
    const fingerprint = await fingerprintFor(identity, fingerprintKey);
    const leaseExpiresAt = nowSeconds + leaseSeconds;
    const [acquired] = this.queryDatabase
      .insert(deliveryRecords)
      .values({
        expiresAt: leaseExpiresAt,
        fingerprint,
        leaseExpiresAt,
        outcome: 'pending',
        reasonCategory: null,
      })
      .onConflictDoUpdate({
        set: {
          expiresAt: leaseExpiresAt,
          leaseExpiresAt,
          outcome: 'pending',
          reasonCategory: null,
        },
        setWhere: sql`${or(
          lte(deliveryRecords.expiresAt, nowSeconds),
          and(
            eq(deliveryRecords.outcome, 'pending'),
            lte(deliveryRecords.leaseExpiresAt, nowSeconds),
          ),
        )}`,
        target: deliveryRecords.fingerprint,
      })
      .returning({ fingerprint: deliveryRecords.fingerprint })
      .all();
    if (acquired !== undefined) {
      return { fingerprint, kind: 'acquired' };
    }

    const existing = this.queryDatabase
      .select({
        leaseExpiresAt: deliveryRecords.leaseExpiresAt,
        outcome: deliveryRecords.outcome,
      })
      .from(deliveryRecords)
      .where(eq(deliveryRecords.fingerprint, fingerprint))
      .get();
    if (existing?.outcome === 'delivered') {
      return { kind: 'delivered' };
    }
    if (existing?.outcome === 'rejected') {
      return { kind: 'rejected' };
    }
    if (existing?.outcome === 'pending') {
      return {
        kind: 'pending',
        retryAfterSeconds: Math.max(
          1,
          (existing.leaseExpiresAt ?? nowSeconds + 1) - nowSeconds,
        ),
      };
    }
    throw new Error('Delivery claim disappeared.');
  }

  cleanup(nowSeconds: number, utcDate: string): Promise<void> {
    const cleanup = this.database.transaction(() => {
      this.queryDatabase
        .delete(deliveryRecords)
        .where(lte(deliveryRecords.expiresAt, nowSeconds))
        .run();
      this.queryDatabase
        .delete(dailyBudgets)
        .where(lt(dailyBudgets.utcDate, utcDate))
        .run();
    });
    cleanup.immediate();
    return Promise.resolve();
  }

  close(): void {
    this.database.close(true);
  }

  completeDelivery(
    fingerprint: string,
    outcome: 'delivered' | 'rejected',
    reasonCategory: string | undefined,
    expiresAt: number,
  ): Promise<void> {
    this.queryDatabase
      .update(deliveryRecords)
      .set({
        expiresAt,
        leaseExpiresAt: null,
        outcome,
        reasonCategory: reasonCategory ?? null,
      })
      .where(eq(deliveryRecords.fingerprint, fingerprint))
      .run();
    return Promise.resolve();
  }

  ready(): Promise<boolean> {
    try {
      const deliveryColumns = this.database
        .query<{ readonly name: string }, []>(
          "SELECT name FROM pragma_table_info('delivery_records') ORDER BY cid",
        )
        .all()
        .map(({ name }) => name);
      const budgetColumns = this.database
        .query<{ readonly name: string }, []>(
          "SELECT name FROM pragma_table_info('daily_budgets') ORDER BY cid",
        )
        .all()
        .map(({ name }) => name);
      const applied = this.database
        .query<AppliedMigration, []>(
          'SELECT name, minimum_reader FROM gateway_migrations ORDER BY name',
        )
        .all();
      const hasExpectedMigrations = this.expectedMigrations.every((name) =>
        applied.some((migration) => migration.name === name),
      );
      const hasOnlyCompatibleMigrations = applied.every(
        ({ name, minimum_reader }) =>
          this.expectedMigrations.includes(name) ||
          this.expectedMigrations.includes(minimum_reader),
      );
      const index = this.database
        .query<{ readonly count: number }, [string]>(
          `SELECT COUNT(*) AS count
           FROM sqlite_master
           WHERE type = 'index'
             AND name = ?1`,
        )
        .get(DELIVERY_EXPIRY_INDEX);
      if (
        !DELIVERY_COLUMNS.every((name) => deliveryColumns.includes(name)) ||
        !BUDGET_COLUMNS.every((name) => budgetColumns.includes(name)) ||
        !hasExpectedMigrations ||
        !hasOnlyCompatibleMigrations ||
        index?.count !== 1
      ) {
        return Promise.resolve(false);
      }

      this.database.run('BEGIN IMMEDIATE');
      try {
        this.queryDatabase
          .insert(dailyBudgets)
          .values({ attempts: 0, utcDate: HEALTH_CHECK_DATE })
          .onConflictDoUpdate({
            set: { attempts: 0 },
            target: dailyBudgets.utcDate,
          })
          .run();
      } finally {
        this.database.run('ROLLBACK');
      }
      return Promise.resolve(true);
    } catch {
      try {
        this.database.run('ROLLBACK');
      } catch {
        // The readiness transaction may not have started.
      }
      return Promise.resolve(false);
    }
  }

  releaseDelivery(fingerprint: string): Promise<void> {
    this.queryDatabase
      .delete(deliveryRecords)
      .where(
        and(
          eq(deliveryRecords.fingerprint, fingerprint),
          eq(deliveryRecords.outcome, 'pending'),
        ),
      )
      .run();
    return Promise.resolve();
  }

  reserveDailyAttempts(
    utcDate: string,
    requestedAttempts: number,
    maximumAttempts: number,
  ): Promise<boolean> {
    if (requestedAttempts === 0) {
      return Promise.resolve(true);
    }
    if (requestedAttempts > maximumAttempts) {
      return Promise.resolve(false);
    }
    const [reserved] = this.queryDatabase
      .insert(dailyBudgets)
      .values({ attempts: requestedAttempts, utcDate })
      .onConflictDoUpdate({
        set: {
          attempts: sql`${dailyBudgets.attempts} + ${requestedAttempts}`,
        },
        setWhere: sql`${dailyBudgets.attempts} + ${requestedAttempts} <= ${maximumAttempts}`,
        target: dailyBudgets.utcDate,
      })
      .returning({ attempts: dailyBudgets.attempts })
      .all();
    return Promise.resolve(reserved !== undefined);
  }
}
