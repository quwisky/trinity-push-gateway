import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SqliteGatewayStore } from '../../src/bun/sqlite-store';
import {
  exerciseStoreContract,
  exerciseUnavailableStoreContract,
} from '../support/store-contract';
import { canonicalMigrations, initialMigration } from './support';

const directories: string[] = [];

function createStore(): {
  readonly directory: string;
  readonly store: SqliteGatewayStore;
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-gateway-'));
  directories.push(directory);
  return {
    directory,
    store: SqliteGatewayStore.open(
      path.join(directory, 'gateway.sqlite'),
      canonicalMigrations,
    ),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('Bun SQLite gateway store', () => {
  it('preserves the shared store contract', async () => {
    const { store } = createStore();

    expect(await exerciseStoreContract(store)).toEqual({
      budget: [true, false, true],
      claims: ['acquired', 'pending', 'acquired', 'rejected', 'acquired'],
      cleanupReleasesExpiredBudget: true,
      concurrentBudgetReservations: 1,
      concurrentClaims: ['acquired', 'pending', 'pending', 'pending'],
      deliveredClaimSurvivesRelease: 'delivered',
      pendingLeaseRecovery: ['acquired', 'pending', 'acquired'],
      zeroAndOversizedBudget: [true, false],
    });

    store.close();
  });

  it('fails closed after its storage adapter becomes unavailable', async () => {
    const { store } = createStore();

    await exerciseUnavailableStoreContract(store, async (operation) => {
      store.close();
      return operation();
    });
  });

  it('migrates an empty database and atomically enforces its daily budget', async () => {
    const { store } = createStore();

    expect(await store.ready()).toBe(true);
    expect(await store.reserveDailyAttempts('2033-05-18', 2, 3)).toBe(true);
    expect(await store.reserveDailyAttempts('2033-05-18', 2, 3)).toBe(false);
    expect(await store.reserveDailyAttempts('2033-05-18', 1, 3)).toBe(true);

    store.close();
  });

  it('reports an incomplete schema as unready', async () => {
    const { directory, store } = createStore();
    store.close();
    const databasePath = path.join(directory, 'gateway.sqlite');
    const database = new Database(databasePath, { strict: true });
    database.run('DROP INDEX delivery_records_expiry_idx');
    database.close(true);

    const reopened = SqliteGatewayStore.open(databasePath, canonicalMigrations);
    expect(await reopened.ready()).toBe(false);
    reopened.close();
  });

  it('persists delivery outcomes and reclaims them after cleanup', async () => {
    const { directory, store } = createStore();
    const identity = {
      accountRoute: 'account-route',
      appId: 'example.android',
      eventId: '$event:example.test',
      pushKey: 'push-key',
    };

    const acquired = await store.claimDelivery(
      identity,
      'k'.repeat(32),
      100,
      10,
    );
    expect(acquired.kind).toBe('acquired');
    if (acquired.kind !== 'acquired') {
      throw new Error('Expected acquired delivery.');
    }
    expect(
      await store.claimDelivery(identity, 'k'.repeat(32), 101, 10),
    ).toEqual({ kind: 'pending', retryAfterSeconds: 9 });
    await store.completeDelivery(
      acquired.fingerprint,
      'delivered',
      undefined,
      200,
    );
    store.close();

    const reopened = SqliteGatewayStore.open(
      path.join(directory, 'gateway.sqlite'),
      canonicalMigrations,
    );
    expect(
      await reopened.claimDelivery(identity, 'k'.repeat(32), 150, 10),
    ).toEqual({ kind: 'delivered' });
    await reopened.cleanup(201, '2033-05-19');
    expect(
      (await reopened.claimDelivery(identity, 'k'.repeat(32), 202, 10)).kind,
    ).toBe('acquired');
    reopened.close();
  });

  it('creates a verified backup without overwriting an existing file', async () => {
    const { directory, store } = createStore();
    const backupPath = path.join(directory, 'backup.sqlite');

    store.backup(backupPath);
    expect(() => {
      store.backup(backupPath);
    }).toThrow('already exists');

    const backup = SqliteGatewayStore.open(backupPath, canonicalMigrations);
    expect(await backup.ready()).toBe(true);
    backup.close();
    store.close();
  });

  it('restores a snapshot offline without retaining stale WAL state', async () => {
    const { directory, store } = createStore();
    const databasePath = path.join(directory, 'gateway.sqlite');
    const backupPath = path.join(directory, 'restore-source.sqlite');
    const identity = {
      accountRoute: 'restored-account',
      appId: 'example.android',
      eventId: '$restored:example.test',
      pushKey: 'restored-key',
    };
    const acquired = await store.claimDelivery(
      identity,
      'r'.repeat(32),
      100,
      10,
    );
    if (acquired.kind !== 'acquired') {
      throw new Error('Expected an acquired delivery before backup.');
    }
    await store.completeDelivery(
      acquired.fingerprint,
      'delivered',
      undefined,
      1_000,
    );
    store.backup(backupPath);
    store.close();

    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    copyFileSync(backupPath, databasePath);

    const restored = SqliteGatewayStore.open(databasePath, canonicalMigrations);
    expect(await restored.ready()).toBe(true);
    expect(
      await restored.claimDelivery(identity, 'r'.repeat(32), 200, 10),
    ).toEqual({ kind: 'delivered' });
    restored.close();
  });

  it('keeps an expand-first migration readable by the previous version', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'trinity-rollback-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'gateway.sqlite');
    const upgraded = SqliteGatewayStore.open(databasePath, [
      initialMigration,
      {
        minimumReader: initialMigration.name,
        name: '0002_additive.sql',
        sql: 'ALTER TABLE delivery_records ADD COLUMN adapter_note TEXT;',
      },
    ]);
    upgraded.close();

    const previous = SqliteGatewayStore.open(databasePath, canonicalMigrations);
    expect(await previous.ready()).toBe(true);
    previous.close();
  });

  it('refuses an incompatible newer migration during rollback', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'trinity-rollback-'));
    directories.push(directory);
    const databasePath = path.join(directory, 'gateway.sqlite');
    const upgraded = SqliteGatewayStore.open(databasePath, [
      initialMigration,
      {
        name: '0002_incompatible.sql',
        sql: 'CREATE TABLE incompatible_schema_marker (value TEXT);',
      },
    ]);
    upgraded.close();

    expect(() =>
      SqliteGatewayStore.open(databasePath, canonicalMigrations),
    ).toThrow('Database schema is newer than this gateway');
  });
});
