import { Database } from 'bun:sqlite';
import { existsSync, rmSync } from 'node:fs';

import { fingerprintFor } from '../fingerprint';
import type { DeliveryClaim, DeliveryIdentity, GatewayStore } from '../ports';
import {
  BUDGET_COLUMNS,
  DELIVERY_COLUMNS,
  DELIVERY_EXPIRY_INDEX,
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

type DeliveryRow = {
  readonly lease_expires_at: number | null;
  readonly outcome: 'delivered' | 'pending' | 'rejected';
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
  private constructor(
    private readonly database: Database,
    private readonly expectedMigrations: readonly string[],
  ) {}

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
    const acquired = this.database
      .query<{ readonly fingerprint: string }, [string, number, number]>(
        `INSERT INTO delivery_records
          (fingerprint, outcome, lease_expires_at, expires_at, reason_category)
         VALUES (?1, 'pending', ?2, ?2, NULL)
         ON CONFLICT (fingerprint) DO UPDATE SET
           outcome = 'pending',
           lease_expires_at = excluded.lease_expires_at,
           expires_at = excluded.expires_at,
           reason_category = NULL
         WHERE delivery_records.expires_at <= ?3
            OR (delivery_records.outcome = 'pending'
                AND delivery_records.lease_expires_at <= ?3)
         RETURNING fingerprint`,
      )
      .get(fingerprint, leaseExpiresAt, nowSeconds);
    if (acquired !== null) {
      return { fingerprint, kind: 'acquired' };
    }

    const existing = this.database
      .query<DeliveryRow, [string]>(
        `SELECT outcome, lease_expires_at
         FROM delivery_records
         WHERE fingerprint = ?1`,
      )
      .get(fingerprint);
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
          (existing.lease_expires_at ?? nowSeconds + 1) - nowSeconds,
        ),
      };
    }
    throw new Error('Delivery claim disappeared.');
  }

  cleanup(nowSeconds: number, utcDate: string): Promise<void> {
    const cleanup = this.database.transaction(() => {
      this.database
        .query('DELETE FROM delivery_records WHERE expires_at <= ?1')
        .run(nowSeconds);
      this.database
        .query('DELETE FROM daily_budgets WHERE utc_date < ?1')
        .run(utcDate);
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
    this.database
      .query(
        `UPDATE delivery_records
         SET outcome = ?2,
             lease_expires_at = NULL,
             expires_at = ?3,
             reason_category = ?4
         WHERE fingerprint = ?1`,
      )
      .run(fingerprint, outcome, expiresAt, reasonCategory ?? null);
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
        this.database
          .query(
            `INSERT INTO daily_budgets (utc_date, attempts)
             VALUES (?1, 0)
             ON CONFLICT (utc_date) DO UPDATE SET attempts = excluded.attempts`,
          )
          .run(HEALTH_CHECK_DATE);
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
    this.database
      .query(
        `DELETE FROM delivery_records
         WHERE fingerprint = ?1 AND outcome = 'pending'`,
      )
      .run(fingerprint);
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
    const reserved = this.database
      .query<{ readonly attempts: number }, [string, number, number]>(
        `INSERT INTO daily_budgets (utc_date, attempts)
         VALUES (?1, ?2)
         ON CONFLICT (utc_date) DO UPDATE SET
           attempts = daily_budgets.attempts + excluded.attempts
         WHERE daily_budgets.attempts + excluded.attempts <= ?3
         RETURNING attempts`,
      )
      .get(utcDate, requestedAttempts, maximumAttempts);
    return Promise.resolve(reserved !== null);
  }
}
