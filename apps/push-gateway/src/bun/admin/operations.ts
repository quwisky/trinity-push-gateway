import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

import type { FirebaseValidator } from '../../fcm';
import type { AdminConfiguration } from './config';
import type {
  AdminOperationKind,
  AdminOperatorIdentity,
  AdminVerifiedBackup,
  SqliteAdminStore,
} from './store';

export type KnownOperationResult = Readonly<{
  completedAt: number;
  cooldownEndsAt: number;
  outcome: 'failed' | 'succeeded';
  reason?: string;
  startedAt: number;
}>;

export type OperationResponse =
  | Readonly<{
      kind: 'backup';
      backup: AdminVerifiedBackup;
      result: KnownOperationResult;
    }>
  | Readonly<{ kind: 'completed'; result: KnownOperationResult }>
  | Readonly<{ kind: 'busy' }>
  | Readonly<{ kind: 'cooldown'; retryAfterSeconds: number }>
  | Readonly<{ kind: 'limit' }>
  | Readonly<{ kind: 'outcome_unknown' }>
  | Readonly<{ kind: 'timeout' }>
  | Readonly<{ kind: 'unavailable' }>;

export type OperationBackend = Readonly<{
  backup(
    targetPath: string,
    deadlineMs: number,
  ): Promise<'failed' | 'verified'>;
  cleanup(deadlineMs: number): Promise<boolean>;
  validateFirebase(deadlineMs: number): Promise<
    Readonly<{
      kind: 'failed' | 'succeeded';
      reason?: string;
    }>
  >;
}>;

async function child(
  entryPath: string,
  command: string,
  args: readonly string[],
  deadlineMs: number,
): Promise<boolean> {
  const subprocess = Bun.spawn(
    [process.execPath, '--no-env-file', entryPath, command, ...args],
    { stderr: 'ignore', stdout: 'ignore' },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(
      () => {
        resolve('timeout');
      },
      Math.max(0, deadlineMs - Date.now()),
    );
  });
  const result = await Promise.race([
    subprocess.exited.then((code) => (code === 0 ? 'ok' : 'failed')),
    timedOut,
  ]);
  clearTimeout(timer);
  if (result === 'timeout') {
    subprocess.kill('SIGKILL');
    await subprocess.exited;
    throw new Error('operation_timeout');
  }
  return result === 'ok';
}

export function createOperationBackend(
  entryPath: string,
  validator: FirebaseValidator,
): OperationBackend {
  return Object.freeze({
    async backup(targetPath, deadlineMs) {
      return (await child(
        entryPath,
        'maintenance-backup',
        [targetPath],
        deadlineMs,
      ))
        ? 'verified'
        : 'failed';
    },
    cleanup: (deadlineMs) =>
      child(entryPath, 'maintenance-cleanup', [], deadlineMs),
    async validateFirebase(deadlineMs) {
      const result = await validator.validate(deadlineMs);
      return result.kind === 'succeeded'
        ? { kind: 'succeeded' as const }
        : { kind: 'failed' as const, reason: result.reason };
    },
  });
}

function generatedBackupName(nowMs: number): string {
  const timestamp = new Date(nowMs)
    .toISOString()
    .replaceAll('-', '')
    .replaceAll(':', '')
    .replace('.000', '');
  return `trinity-gateway-${timestamp}-${randomBytes(6).toString('hex')}.sqlite`;
}

function ensureBackupDirectory(directory: string): void {
  const root = path.parse(directory).root;
  let current = root;
  for (const segment of directory.slice(root.length).split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error('backup_directory_invalid');
    }
  }
  if (!existsSync(directory)) {
    mkdirSync(directory, { mode: 0o700, recursive: true });
  }
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('backup_directory_invalid');
  }
}

const GENERATED_BACKUP_NAME =
  /^trinity-gateway-\d{8}T\d{6}Z-[a-f0-9]{12}\.sqlite$/u;

function regularFileSize(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('backup_source_invalid');
  }
  return stat.size;
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of Bun.file(filePath).stream()) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export class AdminOperations {
  constructor(
    private readonly store: SqliteAdminStore,
    private readonly configuration: AdminConfiguration,
    private readonly backend: OperationBackend,
    private readonly gatewayDatabasePath: string,
    private readonly now: () => number,
  ) {}

  cleanup(actor: AdminOperatorIdentity): Promise<OperationResponse> {
    return this.run('cleanup', actor, (deadlineMs) =>
      this.backend.cleanup(deadlineMs),
    );
  }

  firebaseValidation(actor: AdminOperatorIdentity): Promise<OperationResponse> {
    return this.run('firebase_validation', actor, async (deadlineMs) => {
      const result = await this.backend.validateFirebase(deadlineMs);
      return result;
    });
  }

  async backup(actor: AdminOperatorIdentity): Promise<OperationResponse> {
    const policy = this.policy('backup');
    const startedAt = Math.floor(this.now() / 1_000);
    const lease = this.store.beginOperation(
      'backup',
      actor,
      startedAt,
      policy.deadline,
      policy.cooldown,
    );
    if (lease.kind !== 'acquired') return lease;

    try {
      ensureBackupDirectory(this.configuration.backupDirectory);
      const entries = readdirSync(this.configuration.backupDirectory).slice(
        0,
        this.configuration.backupLimitCount + 1,
      );
      const files = entries.map((name) => ({
        name,
        stat: lstatSync(path.join(this.configuration.backupDirectory, name)),
      }));
      const existingBytes = files.reduce(
        (total, { stat }) =>
          total + (stat.isFile() && !stat.isSymbolicLink() ? stat.size : 0),
        0,
      );
      const sourceSize =
        regularFileSize(this.gatewayDatabasePath) +
        regularFileSize(`${this.gatewayDatabasePath}-wal`) +
        regularFileSize(`${this.gatewayDatabasePath}-shm`);
      if (
        files.some(
          ({ name, stat }) =>
            !GENERATED_BACKUP_NAME.test(name) ||
            !stat.isFile() ||
            stat.isSymbolicLink(),
        ) ||
        files.length >= this.configuration.backupLimitCount ||
        existingBytes + sourceSize > this.configuration.backupLimitBytes
      ) {
        const finalized = this.finish(
          'backup',
          lease.leaseId,
          actor,
          startedAt,
          policy.cooldown,
          'failed',
          'backup_limit_exceeded',
        );
        return finalized.kind === 'outcome_unknown'
          ? finalized
          : { kind: 'limit' };
      }
      const name = generatedBackupName(this.now());
      const targetPath = path.join(this.configuration.backupDirectory, name);
      if (existsSync(targetPath)) throw new Error('backup_name_collision');
      const verification = await this.backend.backup(
        targetPath,
        (startedAt + policy.deadline) * 1_000,
      );
      if (verification !== 'verified') {
        const finalized = this.finish(
          'backup',
          lease.leaseId,
          actor,
          startedAt,
          policy.cooldown,
          'failed',
          'backup_failed',
        );
        return finalized.kind === 'outcome_unknown'
          ? finalized
          : { kind: 'unavailable' };
      }
      const targetStat = lstatSync(targetPath);
      if (
        !targetStat.isFile() ||
        targetStat.isSymbolicLink() ||
        targetStat.size < 1
      ) {
        throw new Error('backup_verification_failed');
      }
      chmodSync(targetPath, 0o600);
      const backup = {
        createdAt: Math.floor(this.now() / 1_000),
        id: crypto.randomUUID(),
        issuer: actor.issuer,
        name,
        sha256: await sha256(targetPath),
        sizeBytes: targetStat.size,
        subject: actor.subject,
      } satisfies AdminVerifiedBackup;
      if (this.now() > (startedAt + policy.deadline) * 1_000) {
        return this.timeout('backup', lease.leaseId, actor, startedAt);
      }
      const result = this.finish(
        'backup',
        lease.leaseId,
        actor,
        startedAt,
        policy.cooldown,
        'succeeded',
        undefined,
        backup,
      );
      return result.kind === 'completed'
        ? { backup, kind: 'backup', result: result.result }
        : result;
    } catch (error) {
      if (error instanceof Error && error.message === 'operation_timeout') {
        return this.timeout('backup', lease.leaseId, actor, startedAt);
      }
      const finalized = this.finish(
        'backup',
        lease.leaseId,
        actor,
        startedAt,
        policy.cooldown,
        'failed',
        'backup_failed',
      );
      return finalized.kind === 'outcome_unknown'
        ? finalized
        : { kind: 'unavailable' };
    }
  }

  private async run(
    kind: Exclude<AdminOperationKind, 'backup'>,
    actor: AdminOperatorIdentity,
    execute: (
      deadlineMs: number,
    ) => Promise<
      boolean | Readonly<{ kind: 'failed' | 'succeeded'; reason?: string }>
    >,
  ): Promise<OperationResponse> {
    const policy = this.policy(kind);
    const startedAt = Math.floor(this.now() / 1_000);
    const lease = this.store.beginOperation(
      kind,
      actor,
      startedAt,
      policy.deadline,
      policy.cooldown,
    );
    if (lease.kind !== 'acquired') return lease;
    try {
      const executed = await execute((startedAt + policy.deadline) * 1_000);
      const succeeded =
        typeof executed === 'boolean'
          ? executed
          : executed.kind === 'succeeded';
      const reason =
        typeof executed === 'boolean'
          ? succeeded
            ? undefined
            : `${kind}_failed`
          : executed.reason;
      return this.finish(
        kind,
        lease.leaseId,
        actor,
        startedAt,
        policy.cooldown,
        succeeded ? 'succeeded' : 'failed',
        reason,
      );
    } catch (error) {
      return error instanceof Error && error.message === 'operation_timeout'
        ? this.timeout(kind, lease.leaseId, actor, startedAt)
        : this.finish(
            kind,
            lease.leaseId,
            actor,
            startedAt,
            policy.cooldown,
            'failed',
            `${kind}_failed`,
          );
    }
  }

  private finish(
    kind: AdminOperationKind,
    leaseId: string,
    actor: AdminOperatorIdentity,
    startedAt: number,
    cooldownSeconds: number,
    outcome: 'failed' | 'succeeded',
    reason?: string,
    backup?: AdminVerifiedBackup,
  ): OperationResponse {
    const completedAt = Math.floor(this.now() / 1_000);
    try {
      this.store.finalizeOperation(
        kind,
        leaseId,
        actor,
        completedAt,
        outcome,
        reason,
        backup,
      );
    } catch {
      try {
        this.store.finalizeOperation(
          kind,
          leaseId,
          actor,
          completedAt,
          'outcome_unknown',
          'audit_finalization_failed',
        );
      } catch {
        // The response remains non-retriable even if the isolated store died.
      }
      return { kind: 'outcome_unknown' };
    }
    return {
      kind: 'completed',
      result: {
        completedAt,
        cooldownEndsAt: startedAt + cooldownSeconds,
        outcome,
        ...(reason === undefined ? {} : { reason }),
        startedAt,
      },
    };
  }

  private timeout(
    kind: AdminOperationKind,
    leaseId: string,
    actor: AdminOperatorIdentity,
    startedAt: number,
  ): OperationResponse {
    const policy = this.policy(kind);
    const result = this.finish(
      kind,
      leaseId,
      actor,
      startedAt,
      policy.cooldown,
      'failed',
      'operation_timeout',
    );
    return result.kind === 'outcome_unknown' ? result : { kind: 'timeout' };
  }

  private policy(
    kind: AdminOperationKind,
  ): Readonly<{ cooldown: number; deadline: number }> {
    if (kind === 'firebase_validation') {
      return {
        cooldown: this.configuration.policy.firebaseValidationCooldownSeconds,
        deadline: this.configuration.policy.firebaseValidationDeadlineSeconds,
      };
    }
    if (kind === 'cleanup') {
      return {
        cooldown: this.configuration.policy.cleanupCooldownSeconds,
        deadline: this.configuration.policy.cleanupDeadlineSeconds,
      };
    }
    return {
      cooldown: this.configuration.policy.backupCooldownSeconds,
      deadline: this.configuration.policy.backupDeadlineSeconds,
    };
  }
}
