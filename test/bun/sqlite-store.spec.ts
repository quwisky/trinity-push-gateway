import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SqliteGatewayStore } from '../../src/bun/sqlite-store';
import { exerciseStoreContract } from '../support/store-contract';

const directories: string[] = [];

function createStore(): {
  readonly directory: string;
  readonly store: SqliteGatewayStore;
} {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-gateway-'));
  directories.push(directory);
  return {
    directory,
    store: SqliteGatewayStore.open(path.join(directory, 'gateway.sqlite'), [
      {
        name: '0001_initial.sql',
        sql: readFileSync(
          path.join(import.meta.dir, '../../migrations/0001_initial.sql'),
          'utf8',
        ),
      },
    ]),
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
    });

    store.close();
  });

  it('migrates an empty database and atomically enforces its daily budget', async () => {
    const { store } = createStore();

    expect(await store.ready()).toBe(true);
    expect(await store.reserveDailyAttempts('2033-05-18', 2, 3)).toBe(true);
    expect(await store.reserveDailyAttempts('2033-05-18', 2, 3)).toBe(false);
    expect(await store.reserveDailyAttempts('2033-05-18', 1, 3)).toBe(true);

    store.close();
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
      [
        {
          name: '0001_initial.sql',
          sql: readFileSync(
            path.join(import.meta.dir, '../../migrations/0001_initial.sql'),
            'utf8',
          ),
        },
      ],
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

    const backup = SqliteGatewayStore.openReadOnly(backupPath);
    expect(await backup.ready()).toBe(true);
    backup.close();
    store.close();
  });
});
