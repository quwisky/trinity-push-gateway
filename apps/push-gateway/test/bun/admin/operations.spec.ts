import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ADMIN_POLICY_DEFAULTS } from '../../../src/configuration-defaults';
import type { AdminConfiguration } from '../../../src/bun/admin/config';
import {
  AdminOperations,
  type OperationBackend,
} from '../../../src/bun/admin/operations';
import { SqliteAdminStore } from '../../../src/bun/admin/store';
import { readMigrations } from '../../../src/bun/migrations';

const ADMIN_MIGRATIONS = readMigrations(
  path.join(import.meta.dir, '../../../admin-migrations'),
);
const directories: string[] = [];

async function harness(backend: OperationBackend): Promise<
  Readonly<{
    actor: Readonly<{ issuer: string; subject: string }>;
    file: string;
    operations: AdminOperations;
    store: SqliteAdminStore;
  }>
> {
  const directory = mkdtempSync(path.join(tmpdir(), 'trinity-operations-'));
  directories.push(directory);
  const file = path.join(directory, 'admin.sqlite');
  const gatewayDatabasePath = path.join(directory, 'gateway.sqlite');
  await Bun.write(gatewayDatabasePath, 'gateway');
  const store = SqliteAdminStore.open(file, ADMIN_MIGRATIONS);
  const configuration: AdminConfiguration = {
    assetsPath: path.join(directory, 'assets'),
    backupDirectory: path.join(directory, 'backups'),
    backupLimitBytes: 1024 * 1024,
    backupLimitCount: 24,
    databasePath: file,
    migrationsPath: path.join(directory, 'migrations'),
    oidcClientId: 'client',
    oidcClientSecret: { source: 'env', value: 'secret' },
    oidcGroupClaim: 'groups',
    oidcIssuer: 'https://issuer.example',
    oidcRequiredGroup: 'operators',
    oidcScopes: ['openid'],
    oidcTokenEndpointAuthMethod: 'client_secret_basic',
    policy: ADMIN_POLICY_DEFAULTS,
    policyFingerprint: 'policy',
    publicOrigin: 'https://gateway.example',
    sessionSecret: { source: 'env', value: 'x'.repeat(32) },
  };
  const actor = { issuer: 'https://issuer.example', subject: 'operator-1' };
  await store.establishSession(actor, {
    id: 'operations-session-0001',
    nowSeconds: 1_000,
    policyFingerprint: 'policy',
    sessionDigest: 'session-digest',
    xsrfDigest: 'xsrf-digest',
  });
  return {
    actor,
    file,
    operations: new AdminOperations(
      store,
      configuration,
      backend,
      gatewayDatabasePath,
      () => 1_001_000,
    ),
    store,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('safe administration operations', () => {
  it('does not execute when the audit intent cannot commit', async () => {
    let cleanupCalls = 0;
    const state = await harness({
      backup: () => Promise.resolve('failed'),
      cleanup: () => {
        cleanupCalls += 1;
        return Promise.resolve(true);
      },
      validateFirebase: () => Promise.resolve({ kind: 'succeeded' }),
    });
    const database = new Database(state.file);
    database.run(`CREATE TRIGGER reject_audit BEFORE INSERT ON operator_audit_entries
      BEGIN SELECT RAISE(FAIL, 'audit unavailable'); END`);
    database.close(true);

    let rejected = false;
    try {
      await state.operations.cleanup(state.actor);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(cleanupCalls).toBe(0);
    state.store.close();
  });

  it('returns non-retriable unknown when outcome audit finalization fails', async () => {
    let file = '';
    const state = await harness({
      backup: () => Promise.resolve('failed'),
      cleanup: () => {
        const database = new Database(file);
        database.run(`CREATE TRIGGER reject_final_audit
          BEFORE INSERT ON operator_audit_entries
          WHEN NEW.outcome <> 'started'
          BEGIN SELECT RAISE(FAIL, 'final audit unavailable'); END`);
        database.close(true);
        return Promise.resolve(true);
      },
      validateFirebase: () => Promise.resolve({ kind: 'succeeded' }),
    });
    file = state.file;

    expect(await state.operations.cleanup(state.actor)).toEqual({
      kind: 'outcome_unknown',
    });
    expect(state.store.operationSummaries()).toEqual([]);
    state.store.close();
  });

  it('records a killed deadline as a known timeout and keeps cooldown', async () => {
    const state = await harness({
      backup: () => Promise.resolve('failed'),
      cleanup: () => Promise.reject(new Error('operation_timeout')),
      validateFirebase: () => Promise.resolve({ kind: 'succeeded' }),
    });

    expect(await state.operations.cleanup(state.actor)).toEqual({
      kind: 'timeout',
    });
    expect(state.store.operationSummaries()).toMatchObject([
      {
        kind: 'cleanup',
        outcome: 'failed',
        reason: 'operation_timeout',
      },
    ]);
    state.store.close();
  });

  it('publishes only integrity-verified generated backup metadata', async () => {
    let target = '';
    const state = await harness({
      backup: (targetPath) => {
        target = targetPath;
        const database = new Database(targetPath, { create: true });
        database.run('CREATE TABLE verified (value TEXT NOT NULL)');
        database.close(true);
        return Promise.resolve('verified');
      },
      cleanup: () => Promise.resolve(true),
      validateFirebase: () => Promise.resolve({ kind: 'succeeded' }),
    });

    const result = await state.operations.backup(state.actor);
    expect(result.kind).toBe('backup');
    if (result.kind !== 'backup') {
      throw new Error('Expected verified backup.');
    }
    expect(result.backup.name).toMatch(
      /^trinity-gateway-\d{8}T\d{6}Z-[a-f0-9]{12}\.sqlite$/u,
    );
    expect(result.backup.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(state.store.listBackups()).toHaveLength(1);
    state.store.close();
  });
});
