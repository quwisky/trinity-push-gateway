import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SqliteAdminStore } from '../../../src/bun/admin/store';
import { readMigrations } from '../../../src/bun/migrations';

const ADMIN_MIGRATIONS = readMigrations(
  path.join(import.meta.dir, '../../../admin-migrations'),
);
const directories: string[] = [];

function databasePath(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-admin-store-'));
  directories.push(directory);
  return path.join(directory, 'admin.sqlite');
}

function openStore(file = databasePath()): {
  readonly file: string;
  readonly store: SqliteAdminStore;
} {
  return { file, store: SqliteAdminStore.open(file, ADMIN_MIGRATIONS) };
}

function sessionOptions(
  index: number,
  nowSeconds = 1_000 + index,
): {
  readonly id: string;
  readonly nowSeconds: number;
  readonly policyFingerprint: string;
  readonly sessionDigest: string;
  readonly xsrfDigest: string;
} {
  return {
    id: `session-management-${index.toString().padStart(4, '0')}`,
    nowSeconds,
    policyFingerprint: 'policy-v1',
    sessionDigest: `session-digest-${index.toString().padStart(4, '0')}`,
    xsrfDigest: `xsrf-digest-${index.toString().padStart(4, '0')}`,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('isolated administration SQLite store', () => {
  it('applies only the administration lineage with durable SQLite settings', async () => {
    const { file, store } = openStore();

    expect(await store.ready()).toBe(true);
    store.close();

    const database = new Database(file, { readonly: true, strict: true });
    expect(
      database
        .query<{ readonly name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .all()
        .map(({ name }) => name),
    ).toEqual([
      'admin_migrations',
      'oidc_login_attempts',
      'operation_leases',
      'operator_audit_entries',
      'operator_identities',
      'operator_sessions',
    ]);
    expect(
      database
        .query<{ readonly name: string }, []>(
          'SELECT name FROM admin_migrations ORDER BY name',
        )
        .all(),
    ).toEqual([{ name: '0001_admin_foundation.sql' }]);
    const definitions = database
      .query<{ readonly sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'table'",
      )
      .all();
    expect(definitions.every(({ sql }) => sql.includes('WITHOUT ROWID'))).toBe(
      true,
    );
    database.close(true);
  });

  it('fails closed on an oversized administration migration history', () => {
    const { file, store } = openStore();
    store.close();
    const database = new Database(file, { strict: true });
    const insert = database.query<
      Record<never, never>,
      [string, string, string]
    >(`INSERT INTO admin_migrations (name, applied_at, minimum_reader)
       VALUES (?1, ?2, ?3)`);
    const seed = database.transaction(() => {
      for (let index = 0; index < 65; index += 1) {
        insert.run(
          `future-${index.toString().padStart(3, '0')}.sql`,
          '2026-01-01T00:00:00.000Z',
          '0001_admin_foundation.sql',
        );
      }
    });
    seed.immediate();
    database.close(true);

    expect(() => SqliteAdminStore.open(file, ADMIN_MIGRATIONS)).toThrow(
      'migration history is too large',
    );
  });

  it('atomically consumes a state only with its exact optional cookie digest', async () => {
    const { store } = openStore();
    const attempt = {
      codeVerifier: 'server-side-verifier',
      expiresAt: 1_300,
      nonce: 'server-side-nonce',
      stateDigest: 'state-digest',
    };

    await store.save(attempt, 'cookie-digest');
    expect(await store.consume('state-digest', 1_000)).toBeUndefined();
    expect(
      await store.consume('state-digest', 1_000, 'wrong-cookie-digest'),
    ).toBeUndefined();
    expect(await store.consume('state-digest', 1_000, 'cookie-digest')).toEqual(
      attempt,
    );
    expect(
      await store.consume('state-digest', 1_000, 'cookie-digest'),
    ).toBeUndefined();

    await store.save({ ...attempt, stateDigest: 'legacy-state' });
    expect(await store.consume('legacy-state', 1_000)).toEqual({
      ...attempt,
      stateDigest: 'legacy-state',
    });
    await store.save({ ...attempt, expiresAt: 1_000, stateDigest: 'expired' });
    expect(await store.consume('expired', 1_000)).toBeUndefined();
    expect(await store.consume('expired', 999)).toBeUndefined();
    store.close();
  });

  it('establishes, renews, prunes, and invalidates opaque sessions', async () => {
    const { file, store } = openStore();
    const first = await store.establishSession(
      {
        displayName: 'Old Name',
        email: 'old@example.test',
        issuer: 'https://issuer.example/',
        subject: 'operator-1',
      },
      sessionOptions(1, 1_000),
    );
    expect(first).toMatchObject({
      absoluteExpiresAt: 29_800,
      idleExpiresAt: 2_800,
      lastSeenAt: 1_000,
    });

    expect(
      await store.authenticateSession(
        'session-digest-0001',
        1_200,
        'policy-v1',
      ),
    ).toEqual({
      kind: 'active',
      session: {
        ...first,
        idleExpiresAt: 3_000,
        lastSeenAt: 1_200,
        xsrfDigest: 'xsrf-digest-0001',
      },
    });

    await store.establishSession(
      { issuer: 'https://issuer.example/', subject: 'operator-1' },
      sessionOptions(2, 1_300),
    );
    expect((await store.listSessions(1_301, 'policy-v1'))[0]?.operator).toEqual(
      {
        issuer: 'https://issuer.example/',
        subject: 'operator-1',
      },
    );

    expect(
      await store.authenticateSession(
        'session-digest-0001',
        1_400,
        'policy-v2',
      ),
    ).toEqual({ kind: 'inactive', reason: 'policy_changed' });
    expect(
      await store.authenticateSession(
        'session-digest-0001',
        1_401,
        'policy-v1',
      ),
    ).toEqual({ kind: 'inactive', reason: 'revoked' });

    const database = new Database(file, { readonly: true, strict: true });
    const columns = database
      .query<{ readonly name: string }, []>(
        "SELECT name FROM pragma_table_info('operator_sessions') ORDER BY cid",
      )
      .all()
      .map(({ name }) => name);
    expect(columns).toContain('session_digest');
    expect(columns).toContain('xsrf_digest');
    expect(columns).not.toContain('session_token');
    expect(columns).not.toContain('xsrf_token');
    expect(
      JSON.stringify(database.query('SELECT * FROM operator_sessions').all()),
    ).not.toContain('raw-session-token');
    database.close(true);
    store.close();
  });

  it('enforces five-per-identity and 100-deployment caps transactionally', async () => {
    const { file, store } = openStore();
    for (let index = 0; index < 6; index += 1) {
      await store.establishSession(
        { issuer: 'https://issuer.example/', subject: 'operator-capped' },
        sessionOptions(index, 1_000 + index),
      );
    }
    expect(
      (await store.listSessions(1_010, 'policy-v1'))
        .filter(({ operator }) => operator.subject === 'operator-capped')
        .map(({ id }) => id),
    ).toEqual([
      'session-management-0005',
      'session-management-0004',
      'session-management-0003',
      'session-management-0002',
      'session-management-0001',
    ]);

    for (let index = 6; index < 102; index += 1) {
      await store.establishSession(
        {
          issuer: 'https://issuer.example/',
          subject: `operator-${index.toString().padStart(4, '0')}`,
        },
        sessionOptions(index, 1_000 + index),
      );
    }
    expect(await store.listSessions(1_200, 'policy-v1')).toHaveLength(100);

    const database = new Database(file, { readonly: true, strict: true });
    expect(
      database
        .query<{ readonly count: number }, []>(
          "SELECT COUNT(*) AS count FROM operator_audit_entries WHERE kind = 'session_cap_eviction'",
        )
        .get()?.count,
    ).toBe(2);
    database.close(true);
    store.close();
  });

  it('rolls identity, cap, session, and login audit writes back together', () => {
    const file = databasePath();
    const initialized = SqliteAdminStore.open(file, ADMIN_MIGRATIONS);
    initialized.close();
    const setup = new Database(file, { strict: true });
    setup.run(`CREATE TRIGGER reject_login_audit
      BEFORE INSERT ON operator_audit_entries
      WHEN NEW.kind = 'login'
      BEGIN
        SELECT RAISE(ABORT, 'injected audit failure');
      END`);
    setup.close(true);
    const store = SqliteAdminStore.open(file, ADMIN_MIGRATIONS);

    expect(() =>
      store.establishSession(
        { issuer: 'https://issuer.example/', subject: 'operator-rollback' },
        sessionOptions(1),
      ),
    ).toThrow('injected audit failure');
    store.close();

    const database = new Database(file, { readonly: true, strict: true });
    for (const table of [
      'operator_identities',
      'operator_sessions',
      'operator_audit_entries',
    ]) {
      expect(
        database
          .query<{ readonly count: number }, []>(
            `SELECT COUNT(*) AS count FROM ${table}`,
          )
          .get()?.count,
      ).toBe(0);
    }
    database.close(true);
  });

  it('revokes, purges, lists, and cleans bounded session state', async () => {
    const { store } = openStore();
    await store.establishSession(
      { issuer: 'https://issuer.example/', subject: 'operator-1' },
      sessionOptions(1, 1_000),
    );
    await store.establishSession(
      { issuer: 'https://issuer.example/', subject: 'operator-2' },
      sessionOptions(2, 1_001),
    );
    expect(await store.revokeSession('session-management-0001', 1_100)).toBe(
      true,
    );
    expect(await store.revokeSession('session-management-0001', 1_101)).toBe(
      false,
    );
    expect(await store.purgeSessions(1_200)).toBe(1);
    expect(await store.purgeSessions(1_201)).toBe(0);
    expect(await store.listSessions(1_202, 'policy-v1')).toEqual([]);

    await store.save({
      codeVerifier: 'verifier',
      expiresAt: 1_200,
      nonce: 'nonce',
      stateDigest: 'expired-attempt',
    });
    expect(await store.cleanup(1_300, 1)).toEqual({
      auditEntries: 5,
      loginAttempts: 1,
      operationLeases: 0,
      sessions: 2,
    });
    expect(await store.ready()).toBe(true);
    store.close();
  });

  it('deletes at most one bounded cleanup batch per table and tick', async () => {
    const { file, store } = openStore();
    store.close();
    const database = new Database(file, { strict: true });
    const insert = database.query<
      Record<never, never>,
      [string, number, string, string]
    >(`INSERT INTO operator_audit_entries
        (id, occurred_at, kind, outcome)
       VALUES (?1, ?2, ?3, ?4)`);
    const seed = database.transaction(() => {
      for (let index = 0; index < 125; index += 1) {
        insert.run(
          `cleanup-audit-${index.toString().padStart(5, '0')}`,
          index,
          'login',
          'succeeded',
        );
      }
    });
    seed.immediate();
    database.close(true);

    const reopened = SqliteAdminStore.open(file, ADMIN_MIGRATIONS);
    expect(await reopened.cleanup(1_000, 1)).toEqual({
      auditEntries: 100,
      loginAttempts: 0,
      operationLeases: 0,
      sessions: 0,
    });
    expect(await reopened.cleanup(1_000, 1)).toEqual({
      auditEntries: 25,
      loginAttempts: 0,
      operationLeases: 0,
      sessions: 0,
    });
    reopened.close();
  });

  it('fails a locked administration cleanup within a short bound', () => {
    const { file, store } = openStore();
    const lock = new Database(file, { strict: true });
    lock.run('BEGIN IMMEDIATE');

    const startedAt = performance.now();
    expect(() => store.cleanup(1_000, 1)).toThrow();
    expect(performance.now() - startedAt).toBeLessThan(250);

    lock.run('ROLLBACK');
    lock.close(true);
    store.close();
  });
});
