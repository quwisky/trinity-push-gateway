import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readMigrations } from '../../src/bun/migrations';
import { SqliteGatewayStore } from '../../src/bun/sqlite-store';
import { canonicalMigrations, initialMigration } from './support';

const directories: string[] = [];

function createDatabasePath(prefix = 'trinity-migrations-'): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  directories.push(directory);
  return path.join(directory, 'gateway.sqlite');
}

function initializeCanonicalDatabase(databasePath: string): void {
  const store = SqliteGatewayStore.open(databasePath, canonicalMigrations);
  store.close();
}

function inspectDatabase(databasePath: string): Database {
  return new Database(databasePath, { readonly: true, strict: true });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Bun SQLite migrations', () => {
  it('reads only migration SQL files in order and parses minimum-reader metadata', () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'trinity-migration-files-'),
    );
    directories.push(directory);
    mkdirSync(path.join(directory, 'meta'));
    writeFileSync(
      path.join(directory, '0003_third.sql'),
      '-- minimum-reader: 0002_second.sql\nSELECT 3;\n',
    );
    writeFileSync(path.join(directory, 'README.md'), 'not a migration\n');
    writeFileSync(path.join(directory, '0001_initial.sql'), 'SELECT 1;\n');
    writeFileSync(
      path.join(directory, '0002_second.sql'),
      '-- minimum-reader: 0001_initial.sql\nSELECT 2;\n',
    );

    expect(readMigrations(directory)).toEqual([
      {
        name: '0001_initial.sql',
        sql: 'SELECT 1;\n',
      },
      {
        minimumReader: '0001_initial.sql',
        name: '0002_second.sql',
        sql: '-- minimum-reader: 0001_initial.sql\nSELECT 2;\n',
      },
      {
        minimumReader: '0002_second.sql',
        name: '0003_third.sql',
        sql: '-- minimum-reader: 0002_second.sql\nSELECT 3;\n',
      },
    ]);
  });

  it('rolls back a failed later migration and its migration record', () => {
    const databasePath = createDatabasePath();
    initializeCanonicalDatabase(databasePath);

    expect(() =>
      SqliteGatewayStore.open(databasePath, [
        initialMigration,
        {
          minimumReader: initialMigration.name,
          name: '0002_failing.sql',
          sql: `CREATE TABLE rolled_back_marker (value TEXT);
                INSERT INTO missing_table (value) VALUES ('failure');`,
        },
      ]),
    ).toThrow();

    const database = inspectDatabase(databasePath);
    expect(
      database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'rolled_back_marker'",
        )
        .get()?.count,
    ).toBe(0);
    expect(
      database
        .query<{ readonly name: string }, []>(
          'SELECT name FROM gateway_migrations ORDER BY name',
        )
        .all(),
    ).toEqual([{ name: initialMigration.name }]);
    database.close(true);
  });

  it('rejects an unknown minimum reader before applying migration SQL', () => {
    const databasePath = createDatabasePath();
    initializeCanonicalDatabase(databasePath);

    expect(() =>
      SqliteGatewayStore.open(databasePath, [
        initialMigration,
        {
          minimumReader: '9999_unknown.sql',
          name: '0002_unknown_reader.sql',
          sql: 'CREATE TABLE unknown_reader_marker (value TEXT);',
        },
      ]),
    ).toThrow('names an unknown minimum reader');

    const database = inspectDatabase(databasePath);
    expect(
      database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'unknown_reader_marker'",
        )
        .get()?.count,
    ).toBe(0);
    expect(
      database
        .query<{ readonly name: string }, []>(
          'SELECT name FROM gateway_migrations ORDER BY name',
        )
        .all(),
    ).toEqual([{ name: initialMigration.name }]);
    database.close(true);
  });

  it('opens a database created by the pre-Drizzle migration contract unchanged', async () => {
    const databasePath = createDatabasePath('trinity-legacy-database-');
    const legacy = new Database(databasePath, { create: true, strict: true });
    legacy.run(initialMigration.sql);
    legacy.run(`CREATE TABLE gateway_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      minimum_reader TEXT NOT NULL
    ) WITHOUT ROWID`);
    legacy
      .query(
        `INSERT INTO gateway_migrations (name, applied_at, minimum_reader)
         VALUES (?1, ?2, ?3)`,
      )
      .run(
        initialMigration.name,
        '2026-01-01T00:00:00.000Z',
        initialMigration.name,
      );
    legacy
      .query(
        `INSERT INTO daily_budgets (utc_date, attempts)
         VALUES (?1, ?2)`,
      )
      .run('2033-05-18', 2);
    legacy.close(true);

    const store = SqliteGatewayStore.open(databasePath, canonicalMigrations);
    expect(await store.ready()).toBe(true);
    store.close();

    const reopened = inspectDatabase(databasePath);
    expect(
      reopened
        .query<{ readonly attempts: number; readonly utc_date: string }, []>(
          'SELECT utc_date, attempts FROM daily_budgets',
        )
        .all(),
    ).toEqual([{ attempts: 2, utc_date: '2033-05-18' }]);
    expect(
      reopened
        .query<{ readonly applied_at: string }, [string]>(
          'SELECT applied_at FROM gateway_migrations WHERE name = ?1',
        )
        .get(initialMigration.name)?.applied_at,
    ).toBe('2026-01-01T00:00:00.000Z');
    reopened.close(true);
  });

  it('keeps migration ownership and physical WITHOUT ROWID tables unchanged', () => {
    const databasePath = createDatabasePath();
    initializeCanonicalDatabase(databasePath);

    const database = inspectDatabase(databasePath);
    expect(
      database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
        )
        .get()?.count,
    ).toBe(0);

    const tableDefinitions = database
      .query<{ readonly name: string; readonly sql: string }, []>(
        `SELECT name, sql
         FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('delivery_records', 'daily_budgets', 'gateway_migrations')
         ORDER BY name`,
      )
      .all();
    expect(tableDefinitions.map(({ name }) => name)).toEqual([
      'daily_budgets',
      'delivery_records',
      'gateway_migrations',
    ]);
    for (const definition of tableDefinitions) {
      expect(definition.sql.toUpperCase()).toContain('WITHOUT ROWID');
    }
    database.close(true);
  });
});
