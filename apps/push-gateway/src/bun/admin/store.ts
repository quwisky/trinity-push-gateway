import { Database } from 'bun:sqlite';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

import type {
  OidcLoginAttempt,
  OidcLoginAttemptStore,
  OperatorIdentityProjection,
} from '../auth/oidc-client';
import {
  OPERATOR_SESSION_POLICY,
  selectOperatorSessionEvictions,
  type OperatorSession,
} from '../auth/session-policy';
import type { SqlMigration } from '../sqlite-store';
import {
  adminSchema,
  fcmMetricsHourly,
  oidcLoginAttempts,
  operationLeases,
  operationResults,
  operatorAuditEntries,
  operatorIdentities,
  operatorSessions,
  requestMetricsHourly,
  verifiedBackups,
  type AdminSchema,
} from './schema';

const DEFAULT_AUDIT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
const ADMIN_BUSY_TIMEOUT_MS = 50;
const ADMIN_CLEANUP_BATCH_SIZE = 100;
const ADMIN_MIGRATION_RECORD_LIMIT = 64;

type AppliedAdminMigration = {
  readonly minimum_reader: string;
  readonly name: string;
};

type IdentityRow = typeof operatorIdentities.$inferSelect;
type SessionRow = typeof operatorSessions.$inferSelect;

export type AdminOperatorIdentity = {
  readonly displayName?: string;
  readonly email?: string;
  readonly issuer: string;
  readonly subject: string;
};

export type AdminOperatorSession = {
  readonly absoluteExpiresAt: number;
  readonly createdAt: number;
  readonly id: string;
  readonly idleExpiresAt: number;
  readonly lastSeenAt: number;
  readonly operator: AdminOperatorIdentity;
};

export type AdminAuthenticatedSession = AdminOperatorSession & {
  readonly xsrfDigest: string;
};

export type AdminSessionAuthentication =
  | {
      readonly kind: 'active';
      readonly session: AdminAuthenticatedSession;
    }
  | {
      readonly kind: 'inactive';
      readonly reason:
        | 'absolute_expired'
        | 'idle_expired'
        | 'missing'
        | 'policy_changed'
        | 'revoked';
    };

export type EstablishOperatorSessionOptions = {
  readonly id: string;
  readonly nowSeconds: number;
  readonly policyFingerprint: string;
  readonly sessionDigest: string;
  readonly xsrfDigest: string;
};

export type AdminCleanupResult = {
  readonly auditEntries: number;
  readonly loginAttempts: number;
  readonly operationLeases: number;
  readonly sessions: number;
};

export type AdminAuditEntry = typeof operatorAuditEntries.$inferSelect;
export type AdminAuditFilter = Readonly<{
  before?: Readonly<{ id: string; occurredAt: number }>;
  from: number;
  kind?: AdminAuditEntry['kind'];
  limit: number;
  outcome?: AdminAuditEntry['outcome'];
  to: number;
}>;
export type AdminOperationKind = typeof operationLeases.$inferInsert.kind;
export type AdminOperationOutcome =
  typeof operationResults.$inferInsert.outcome;
export type AdminOperationSummary = Readonly<{
  acquiredAt: number;
  completedAt: number;
  cooldownEndsAt: number;
  kind: AdminOperationKind;
  outcome: AdminOperationOutcome;
  reason: string | null;
}>;
export type AdminVerifiedBackup = typeof verifiedBackups.$inferSelect;
export type BeginOperationResult =
  | Readonly<{ kind: 'acquired'; leaseId: string }>
  | Readonly<{ kind: 'busy' }>
  | Readonly<{ kind: 'cooldown'; retryAfterSeconds: number }>;

type OidcLoginAttemptWithCookie = OidcLoginAttempt & {
  readonly cookieDigest?: string;
};

function configure(database: Database): void {
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA synchronous = FULL');
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA busy_timeout = 50');
}

function applyMigrations(
  database: Database,
  migrations: readonly SqlMigration[],
): readonly string[] {
  if (migrations.length > ADMIN_MIGRATION_RECORD_LIMIT) {
    throw new Error('Administration migration set is too large.');
  }
  database.run(`CREATE TABLE IF NOT EXISTS admin_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL,
    minimum_reader TEXT NOT NULL
  ) WITHOUT ROWID`);
  const applied = database
    .query<AppliedAdminMigration, [number]>(
      `SELECT name, minimum_reader
       FROM admin_migrations
       ORDER BY name
       LIMIT ?1`,
    )
    .all(ADMIN_MIGRATION_RECORD_LIMIT + 1);
  if (applied.length > ADMIN_MIGRATION_RECORD_LIMIT) {
    throw new Error('Administration migration history is too large.');
  }
  const expected = migrations.map(({ name }) => name).sort();
  const incompatible = applied.filter(
    ({ name, minimum_reader }) =>
      !expected.includes(name) && !expected.includes(minimum_reader),
  );
  if (incompatible.length > 0) {
    throw new Error('Administration database schema is not compatible.');
  }

  const migrate = database.transaction(() => {
    for (const migration of [...migrations].sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (applied.some(({ name }) => name === migration.name)) {
        continue;
      }
      const minimumReader = migration.minimumReader ?? migration.name;
      if (!expected.includes(minimumReader)) {
        throw new Error('Administration migration metadata is invalid.');
      }
      database.run(migration.sql);
      database
        .query(
          `INSERT INTO admin_migrations (name, applied_at, minimum_reader)
           VALUES (?1, ?2, ?3)`,
        )
        .run(migration.name, new Date().toISOString(), minimumReader);
    }
  });
  migrate.immediate();
  return expected;
}

function nonEmptyOptional(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

function identityFrom(row: IdentityRow): AdminOperatorIdentity {
  return {
    ...(row.displayName === null ? {} : { displayName: row.displayName }),
    ...(row.email === null ? {} : { email: row.email }),
    issuer: row.issuer,
    subject: row.subject,
  };
}

function sessionFrom(
  session: SessionRow,
  identity: IdentityRow,
): AdminOperatorSession {
  return {
    absoluteExpiresAt: session.absoluteExpiresAt,
    createdAt: session.createdAt,
    id: session.id,
    idleExpiresAt: session.idleExpiresAt,
    lastSeenAt: session.lastSeenAt,
    operator: identityFrom(identity),
  };
}

function assertSessionInput(
  identity: OperatorIdentityProjection,
  options: EstablishOperatorSessionOptions,
): void {
  if (
    identity.issuer.length === 0 ||
    identity.subject.length === 0 ||
    options.id.length === 0 ||
    options.policyFingerprint.length === 0 ||
    options.sessionDigest.length === 0 ||
    options.xsrfDigest.length === 0 ||
    options.sessionDigest === options.xsrfDigest ||
    !Number.isSafeInteger(options.nowSeconds) ||
    options.nowSeconds < 0
  ) {
    throw new Error('Operator Session input is invalid.');
  }
}

function inactiveReason(
  session: SessionRow,
  nowSeconds: number,
  currentPolicyFingerprint: string,
): Exclude<AdminSessionAuthentication, { readonly kind: 'active' }>['reason'] {
  if (session.revokedAt !== null) {
    return 'revoked';
  }
  if (session.policyFingerprint !== currentPolicyFingerprint) {
    return 'policy_changed';
  }
  if (nowSeconds >= session.absoluteExpiresAt) {
    return 'absolute_expired';
  }
  if (nowSeconds >= session.idleExpiresAt) {
    return 'idle_expired';
  }
  return 'missing';
}

function policySession(row: SessionRow): OperatorSession {
  return {
    absoluteExpiresAt: row.absoluteExpiresAt,
    createdAt: row.createdAt,
    id: row.id,
    identity: { issuer: row.issuer, subject: row.subject },
    idleExpiresAt: row.idleExpiresAt,
    policyFingerprint: row.policyFingerprint,
    revokedAt: row.revokedAt ?? undefined,
    xsrfToken: row.xsrfDigest,
  };
}

export class SqliteAdminStore implements OidcLoginAttemptStore {
  private readonly queryDatabase: BunSQLiteDatabase<AdminSchema>;

  private constructor(
    private readonly database: Database,
    private readonly expectedMigrations: readonly string[],
  ) {
    this.queryDatabase = drizzle(database, { schema: adminSchema });
  }

  static open(
    databasePath: string,
    migrations: readonly SqlMigration[],
  ): SqliteAdminStore {
    const database = new Database(databasePath, { create: true, strict: true });
    try {
      configure(database);
      const expectedMigrations = applyMigrations(database, migrations);
      return new SqliteAdminStore(database, expectedMigrations);
    } catch (error) {
      database.close(true);
      throw error;
    }
  }

  close(): void {
    this.database.close(true);
  }

  consume(
    stateDigest: string,
    nowSeconds: number,
    cookieDigest?: string,
  ): Promise<OidcLoginAttempt | undefined> {
    const consumed = this.queryDatabase
      .delete(oidcLoginAttempts)
      .where(
        and(
          eq(oidcLoginAttempts.stateDigest, stateDigest),
          cookieDigest === undefined
            ? isNull(oidcLoginAttempts.cookieDigest)
            : eq(oidcLoginAttempts.cookieDigest, cookieDigest),
        ),
      )
      .returning()
      .get();
    if (consumed === undefined || nowSeconds >= consumed.expiresAt) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      codeVerifier: consumed.codeVerifier,
      expiresAt: consumed.expiresAt,
      nonce: consumed.nonce,
      stateDigest: consumed.stateDigest,
    });
  }

  save(attempt: OidcLoginAttempt, cookieDigest?: string): Promise<void> {
    const attemptWithCookie = attempt as OidcLoginAttemptWithCookie;
    this.queryDatabase
      .insert(oidcLoginAttempts)
      .values({
        codeVerifier: attempt.codeVerifier,
        cookieDigest: cookieDigest ?? attemptWithCookie.cookieDigest ?? null,
        expiresAt: attempt.expiresAt,
        nonce: attempt.nonce,
        stateDigest: attempt.stateDigest,
      })
      .run();
    return Promise.resolve();
  }

  establishSession(
    identity: OperatorIdentityProjection,
    options: EstablishOperatorSessionOptions,
  ): Promise<AdminOperatorSession> {
    assertSessionInput(identity, options);
    const establish = this.database.transaction(() => {
      this.queryDatabase
        .insert(operatorIdentities)
        .values({
          createdAt: options.nowSeconds,
          displayName: nonEmptyOptional(identity.displayName),
          email: nonEmptyOptional(identity.email),
          issuer: identity.issuer,
          subject: identity.subject,
          updatedAt: options.nowSeconds,
        })
        .onConflictDoUpdate({
          set: {
            displayName: nonEmptyOptional(identity.displayName),
            email: nonEmptyOptional(identity.email),
            updatedAt: options.nowSeconds,
          },
          target: [operatorIdentities.issuer, operatorIdentities.subject],
        })
        .run();

      const activeSessions = this.queryDatabase
        .select()
        .from(operatorSessions)
        .where(
          and(
            isNull(operatorSessions.revokedAt),
            gt(operatorSessions.idleExpiresAt, options.nowSeconds),
            gt(operatorSessions.absoluteExpiresAt, options.nowSeconds),
            eq(operatorSessions.policyFingerprint, options.policyFingerprint),
          ),
        )
        .all();
      const evictions = selectOperatorSessionEvictions(
        activeSessions.map(policySession),
        { issuer: identity.issuer, subject: identity.subject },
      );
      if (evictions.length > 0) {
        this.queryDatabase
          .update(operatorSessions)
          .set({ revokedAt: options.nowSeconds })
          .where(inArray(operatorSessions.id, [...evictions]))
          .run();
        for (const ignored of evictions) {
          void ignored;
          this.insertAudit(
            'session_cap_eviction',
            'succeeded',
            options.nowSeconds,
            identity,
            'session_cap',
          );
        }
      }

      const row: SessionRow = {
        absoluteExpiresAt:
          options.nowSeconds + OPERATOR_SESSION_POLICY.absoluteSeconds,
        createdAt: options.nowSeconds,
        id: options.id,
        idleExpiresAt: options.nowSeconds + OPERATOR_SESSION_POLICY.idleSeconds,
        issuer: identity.issuer,
        lastSeenAt: options.nowSeconds,
        policyFingerprint: options.policyFingerprint,
        revokedAt: null,
        sessionDigest: options.sessionDigest,
        subject: identity.subject,
        xsrfDigest: options.xsrfDigest,
      };
      this.queryDatabase.insert(operatorSessions).values(row).run();
      this.insertAudit('login', 'succeeded', options.nowSeconds, identity);

      const persistedIdentity = this.queryDatabase
        .select()
        .from(operatorIdentities)
        .where(
          and(
            eq(operatorIdentities.issuer, identity.issuer),
            eq(operatorIdentities.subject, identity.subject),
          ),
        )
        .get();
      if (persistedIdentity === undefined) {
        throw new Error(
          'Operator Identity disappeared during session creation.',
        );
      }
      return sessionFrom(row, persistedIdentity);
    });
    return Promise.resolve(establish.immediate());
  }

  authenticateSession(
    sessionDigest: string,
    nowSeconds: number,
    currentPolicyFingerprint: string,
  ): Promise<AdminSessionAuthentication> {
    const authenticate = this.database.transaction(() => {
      const record = this.queryDatabase
        .select({ identity: operatorIdentities, session: operatorSessions })
        .from(operatorSessions)
        .innerJoin(
          operatorIdentities,
          and(
            eq(operatorSessions.issuer, operatorIdentities.issuer),
            eq(operatorSessions.subject, operatorIdentities.subject),
          ),
        )
        .where(eq(operatorSessions.sessionDigest, sessionDigest))
        .get();
      if (record === undefined) {
        return { kind: 'inactive', reason: 'missing' } as const;
      }

      const reason = inactiveReason(
        record.session,
        nowSeconds,
        currentPolicyFingerprint,
      );
      if (reason !== 'missing') {
        if (reason !== 'revoked') {
          this.queryDatabase
            .update(operatorSessions)
            .set({ revokedAt: Math.max(nowSeconds, record.session.createdAt) })
            .where(
              and(
                eq(operatorSessions.id, record.session.id),
                isNull(operatorSessions.revokedAt),
              ),
            )
            .run();
          this.insertAudit(
            reason === 'policy_changed' ? 'policy_rejected' : 'session_expired',
            'succeeded',
            nowSeconds,
            identityFrom(record.identity),
            reason,
          );
        }
        return { kind: 'inactive', reason } as const;
      }

      const lastSeenAt = Math.max(
        record.session.createdAt,
        record.session.lastSeenAt,
        nowSeconds,
      );
      const idleExpiresAt = Math.min(
        record.session.absoluteExpiresAt,
        lastSeenAt + OPERATOR_SESSION_POLICY.idleSeconds,
      );
      this.queryDatabase
        .update(operatorSessions)
        .set({ idleExpiresAt, lastSeenAt })
        .where(eq(operatorSessions.id, record.session.id))
        .run();
      return {
        kind: 'active',
        session: {
          ...sessionFrom(
            { ...record.session, idleExpiresAt, lastSeenAt },
            record.identity,
          ),
          xsrfDigest: record.session.xsrfDigest,
        },
      } as const;
    });
    return Promise.resolve(authenticate.immediate());
  }

  listSessions(
    nowSeconds: number,
    currentPolicyFingerprint: string,
  ): Promise<readonly AdminOperatorSession[]> {
    const list = this.database.transaction(() => {
      this.revokeInactiveSessions(nowSeconds, currentPolicyFingerprint);
      return this.queryDatabase
        .select({ identity: operatorIdentities, session: operatorSessions })
        .from(operatorSessions)
        .innerJoin(
          operatorIdentities,
          and(
            eq(operatorSessions.issuer, operatorIdentities.issuer),
            eq(operatorSessions.subject, operatorIdentities.subject),
          ),
        )
        .where(
          and(
            isNull(operatorSessions.revokedAt),
            gt(operatorSessions.idleExpiresAt, nowSeconds),
            gt(operatorSessions.absoluteExpiresAt, nowSeconds),
            eq(operatorSessions.policyFingerprint, currentPolicyFingerprint),
          ),
        )
        .orderBy(desc(operatorSessions.lastSeenAt), asc(operatorSessions.id))
        .limit(OPERATOR_SESSION_POLICY.maximumGlobalSessions)
        .all()
        .map(({ identity, session }) => sessionFrom(session, identity));
    });
    return Promise.resolve(list.immediate());
  }

  logoutSession(
    id: string,
    nowSeconds: number,
    actor: AdminOperatorIdentity,
  ): Promise<boolean> {
    return this.revokeSessionWithAudit(id, nowSeconds, actor, 'logout');
  }

  revokeSession(
    id: string,
    nowSeconds: number,
    actor: AdminOperatorIdentity | null = null,
  ): Promise<boolean> {
    return this.revokeSessionWithAudit(
      id,
      nowSeconds,
      actor,
      'session_revoked',
    );
  }

  private revokeSessionWithAudit(
    id: string,
    nowSeconds: number,
    actor: AdminOperatorIdentity | null,
    kind: 'logout' | 'session_revoked',
  ): Promise<boolean> {
    const revoke = this.database.transaction(() => {
      const revoked = this.queryDatabase
        .update(operatorSessions)
        .set({ revokedAt: nowSeconds })
        .where(
          and(eq(operatorSessions.id, id), isNull(operatorSessions.revokedAt)),
        )
        .returning({ id: operatorSessions.id })
        .all();
      if (revoked.length === 0) {
        return false;
      }
      this.insertAudit(kind, 'succeeded', nowSeconds, actor ?? undefined);
      return true;
    });
    return Promise.resolve(revoke.immediate());
  }

  purgeSessions(nowSeconds: number): Promise<number> {
    const purge = this.database.transaction(() => {
      const revoked = this.queryDatabase
        .update(operatorSessions)
        .set({ revokedAt: nowSeconds })
        .where(isNull(operatorSessions.revokedAt))
        .returning({ id: operatorSessions.id })
        .all();
      this.insertAudit(
        'session_purge',
        'succeeded',
        nowSeconds,
        undefined,
        revoked.length === 0 ? 'no_active_sessions' : undefined,
      );
      return revoked.length;
    });
    return Promise.resolve(purge.immediate());
  }

  metrics(
    fromSeconds: number,
    toSeconds: number,
  ): Readonly<{
    fcm: readonly (typeof fcmMetricsHourly.$inferSelect)[];
    requests: readonly (typeof requestMetricsHourly.$inferSelect)[];
  }> {
    return {
      fcm: this.queryDatabase
        .select()
        .from(fcmMetricsHourly)
        .where(
          and(
            gte(fcmMetricsHourly.hour, fromSeconds),
            lt(fcmMetricsHourly.hour, toSeconds),
          ),
        )
        .orderBy(asc(fcmMetricsHourly.hour), asc(fcmMetricsHourly.platform))
        .limit(1_440)
        .all(),
      requests: this.queryDatabase
        .select()
        .from(requestMetricsHourly)
        .where(
          and(
            gte(requestMetricsHourly.hour, fromSeconds),
            lt(requestMetricsHourly.hour, toSeconds),
          ),
        )
        .orderBy(asc(requestMetricsHourly.hour))
        .limit(720)
        .all(),
    };
  }

  listAuditEntries(filter: AdminAuditFilter): readonly AdminAuditEntry[] {
    const conditions = [
      gte(operatorAuditEntries.occurredAt, filter.from),
      lt(operatorAuditEntries.occurredAt, filter.to),
      ...(filter.kind === undefined
        ? []
        : [eq(operatorAuditEntries.kind, filter.kind)]),
      ...(filter.outcome === undefined
        ? []
        : [eq(operatorAuditEntries.outcome, filter.outcome)]),
      ...(filter.before === undefined
        ? []
        : [
            or(
              lt(operatorAuditEntries.occurredAt, filter.before.occurredAt),
              and(
                eq(operatorAuditEntries.occurredAt, filter.before.occurredAt),
                lt(operatorAuditEntries.id, filter.before.id),
              ),
            ),
          ]),
    ];
    return this.queryDatabase
      .select()
      .from(operatorAuditEntries)
      .where(and(...conditions))
      .orderBy(
        desc(operatorAuditEntries.occurredAt),
        desc(operatorAuditEntries.id),
      )
      .limit(Math.min(101, filter.limit + 1))
      .all();
  }

  listBackups(): readonly AdminVerifiedBackup[] {
    return this.queryDatabase
      .select()
      .from(verifiedBackups)
      .orderBy(desc(verifiedBackups.createdAt), desc(verifiedBackups.id))
      .limit(1_000)
      .all();
  }

  operationSummaries(): readonly AdminOperationSummary[] {
    return this.queryDatabase
      .select({ lease: operationLeases, result: operationResults })
      .from(operationLeases)
      .innerJoin(
        operationResults,
        and(
          eq(operationResults.kind, operationLeases.kind),
          eq(operationResults.leaseId, operationLeases.leaseId),
        ),
      )
      .all()
      .map(({ lease, result }) => ({
        acquiredAt: lease.acquiredAt,
        completedAt: result.completedAt,
        cooldownEndsAt: lease.cooldownEndsAt,
        kind: lease.kind,
        outcome: result.outcome,
        reason: result.reason,
      }));
  }

  beginOperation(
    kind: AdminOperationKind,
    actor: AdminOperatorIdentity,
    nowSeconds: number,
    deadlineSeconds: number,
    cooldownSeconds: number,
  ): BeginOperationResult {
    const begin = this.database.transaction((): BeginOperationResult => {
      const existing = this.queryDatabase
        .select({ lease: operationLeases, result: operationResults })
        .from(operationLeases)
        .leftJoin(
          operationResults,
          eq(operationResults.kind, operationLeases.kind),
        )
        .all();
      const conflicts =
        kind === 'firebase_validation'
          ? existing.filter(({ lease }) => lease.kind === kind)
          : existing.filter(({ lease }) =>
              ['cleanup', 'backup'].includes(lease.kind),
            );
      if (
        conflicts.some(
          ({ lease, result }) =>
            lease.leaseExpiresAt > nowSeconds &&
            result?.leaseId !== lease.leaseId,
        )
      ) {
        return { kind: 'busy' };
      }
      const same = existing.find(({ lease }) => lease.kind === kind);
      if (same !== undefined && same.lease.cooldownEndsAt > nowSeconds) {
        return {
          kind: 'cooldown',
          retryAfterSeconds: same.lease.cooldownEndsAt - nowSeconds,
        };
      }
      const leaseId = crypto.randomUUID();
      this.queryDatabase
        .delete(operationResults)
        .where(eq(operationResults.kind, kind))
        .run();
      this.queryDatabase
        .insert(operationLeases)
        .values({
          acquiredAt: nowSeconds,
          cooldownEndsAt: nowSeconds + cooldownSeconds,
          kind,
          leaseExpiresAt: nowSeconds + deadlineSeconds,
          leaseId,
        })
        .onConflictDoUpdate({
          set: {
            acquiredAt: nowSeconds,
            cooldownEndsAt: nowSeconds + cooldownSeconds,
            leaseExpiresAt: nowSeconds + deadlineSeconds,
            leaseId,
          },
          target: operationLeases.kind,
        })
        .run();
      this.insertAudit(kind, 'started', nowSeconds, actor);
      return { kind: 'acquired', leaseId };
    });
    return begin.immediate();
  }

  finalizeOperation(
    kind: AdminOperationKind,
    leaseId: string,
    actor: AdminOperatorIdentity,
    completedAt: number,
    outcome: AdminOperationOutcome,
    reason?: string,
    backup?: Omit<AdminVerifiedBackup, 'issuer' | 'subject'>,
  ): void {
    const finalize = this.database.transaction(() => {
      const lease = this.queryDatabase
        .select()
        .from(operationLeases)
        .where(
          and(
            eq(operationLeases.kind, kind),
            eq(operationLeases.leaseId, leaseId),
          ),
        )
        .get();
      if (lease === undefined) {
        throw new Error('Operation lease is no longer current.');
      }
      this.queryDatabase
        .insert(operationResults)
        .values({
          completedAt,
          kind,
          leaseId,
          outcome,
          ...(reason === undefined ? {} : { reason }),
        })
        .onConflictDoUpdate({
          set: {
            completedAt,
            leaseId,
            outcome,
            reason: reason ?? null,
          },
          target: operationResults.kind,
        })
        .run();
      if (backup !== undefined) {
        this.queryDatabase
          .insert(verifiedBackups)
          .values({ ...backup, issuer: actor.issuer, subject: actor.subject })
          .run();
      }
      this.insertAudit(kind, outcome, completedAt, actor, reason);
    });
    finalize.immediate();
  }

  cleanup(
    nowSeconds: number,
    auditRetentionSeconds = DEFAULT_AUDIT_RETENTION_SECONDS,
    metricsRetentionSeconds = 30 * 24 * 60 * 60,
    includeRetention = true,
  ): Promise<AdminCleanupResult> {
    if (
      !Number.isSafeInteger(nowSeconds) ||
      nowSeconds < 0 ||
      !Number.isSafeInteger(auditRetentionSeconds) ||
      auditRetentionSeconds < 1 ||
      !Number.isSafeInteger(metricsRetentionSeconds) ||
      metricsRetentionSeconds < 1
    ) {
      throw new Error('Administration cleanup input is invalid.');
    }
    const cleanup = this.database.transaction(() => {
      const expiredAuditEntries = includeRetention
        ? this.queryDatabase
            .select({ id: operatorAuditEntries.id })
            .from(operatorAuditEntries)
            .where(
              lte(
                operatorAuditEntries.occurredAt,
                nowSeconds - auditRetentionSeconds,
              ),
            )
            .orderBy(
              asc(operatorAuditEntries.occurredAt),
              asc(operatorAuditEntries.id),
            )
            .limit(ADMIN_CLEANUP_BATCH_SIZE)
            .all()
        : [];
      const expiredLoginAttempts = this.queryDatabase
        .select({ stateDigest: oidcLoginAttempts.stateDigest })
        .from(oidcLoginAttempts)
        .where(lte(oidcLoginAttempts.expiresAt, nowSeconds))
        .orderBy(
          asc(oidcLoginAttempts.expiresAt),
          asc(oidcLoginAttempts.stateDigest),
        )
        .limit(ADMIN_CLEANUP_BATCH_SIZE)
        .all();
      const expiredRequestMetrics = includeRetention
        ? this.queryDatabase
            .select({ hour: requestMetricsHourly.hour })
            .from(requestMetricsHourly)
            .where(
              lte(
                requestMetricsHourly.hour,
                nowSeconds - metricsRetentionSeconds,
              ),
            )
            .orderBy(asc(requestMetricsHourly.hour))
            .limit(ADMIN_CLEANUP_BATCH_SIZE)
            .all()
        : [];
      const expiredFcmMetrics = includeRetention
        ? this.queryDatabase
            .select({
              hour: fcmMetricsHourly.hour,
              platform: fcmMetricsHourly.platform,
            })
            .from(fcmMetricsHourly)
            .where(
              lte(fcmMetricsHourly.hour, nowSeconds - metricsRetentionSeconds),
            )
            .orderBy(asc(fcmMetricsHourly.hour), asc(fcmMetricsHourly.platform))
            .limit(ADMIN_CLEANUP_BATCH_SIZE)
            .all()
        : [];
      const expiredSessions = this.queryDatabase
        .select({ id: operatorSessions.id })
        .from(operatorSessions)
        .where(
          or(
            isNotNull(operatorSessions.revokedAt),
            lte(operatorSessions.idleExpiresAt, nowSeconds),
            lte(operatorSessions.absoluteExpiresAt, nowSeconds),
          ),
        )
        .orderBy(asc(operatorSessions.idleExpiresAt), asc(operatorSessions.id))
        .limit(ADMIN_CLEANUP_BATCH_SIZE)
        .all();

      const changedRows = (): number =>
        this.database
          .query<{ readonly changes: number }, []>(
            'SELECT changes() AS changes',
          )
          .get()?.changes ?? 0;

      this.queryDatabase
        .delete(operatorAuditEntries)
        .where(
          inArray(
            operatorAuditEntries.id,
            expiredAuditEntries.map(({ id }) => id),
          ),
        )
        .run();
      const auditEntries = changedRows();
      this.queryDatabase
        .delete(oidcLoginAttempts)
        .where(
          inArray(
            oidcLoginAttempts.stateDigest,
            expiredLoginAttempts.map(({ stateDigest }) => stateDigest),
          ),
        )
        .run();
      const loginAttempts = changedRows();
      this.queryDatabase
        .delete(requestMetricsHourly)
        .where(
          inArray(
            requestMetricsHourly.hour,
            expiredRequestMetrics.map(({ hour }) => hour),
          ),
        )
        .run();
      void changedRows();
      for (const row of expiredFcmMetrics) {
        this.queryDatabase
          .delete(fcmMetricsHourly)
          .where(
            and(
              eq(fcmMetricsHourly.hour, row.hour),
              eq(fcmMetricsHourly.platform, row.platform),
            ),
          )
          .run();
      }
      void expiredFcmMetrics.length;
      this.queryDatabase
        .delete(operatorSessions)
        .where(
          inArray(
            operatorSessions.id,
            expiredSessions.map(({ id }) => id),
          ),
        )
        .run();
      const sessions = changedRows();

      return {
        auditEntries,
        loginAttempts,
        operationLeases: 0,
        sessions,
      };
    });
    return Promise.resolve(cleanup.immediate());
  }

  ready(): Promise<boolean> {
    try {
      const applied = this.database
        .query<AppliedAdminMigration, [number]>(
          `SELECT name, minimum_reader
           FROM admin_migrations
           ORDER BY name
           LIMIT ?1`,
        )
        .all(ADMIN_MIGRATION_RECORD_LIMIT + 1);
      if (applied.length > ADMIN_MIGRATION_RECORD_LIMIT) {
        return Promise.resolve(false);
      }
      const migrationsReady = this.expectedMigrations.every((name) =>
        applied.some((migration) => migration.name === name),
      );
      const migrationsCompatible = applied.every(
        ({ name, minimum_reader }) =>
          this.expectedMigrations.includes(name) ||
          this.expectedMigrations.includes(minimum_reader),
      );
      const requiredTables = [
        'admin_migrations',
        'fcm_metrics_hourly',
        'oidc_login_attempts',
        'operation_leases',
        'operation_results',
        'operator_audit_entries',
        'operator_identities',
        'operator_sessions',
        'request_metrics_hourly',
        'verified_backups',
      ];
      const requiredIndexes = [
        'oidc_login_attempts_cookie_digest_idx',
        'oidc_login_attempts_expiry_idx',
        'operation_leases_expiry_idx',
        'operation_leases_lease_id_idx',
        'operator_audit_entries_identity_idx',
        'operator_audit_entries_kind_occurred_idx',
        'operator_audit_entries_kind_outcome_occurred_idx',
        'operator_audit_entries_occurred_idx',
        'operator_audit_entries_outcome_occurred_idx',
        'operator_sessions_expiry_idx',
        'operator_sessions_identity_idx',
        'operator_sessions_last_seen_idx',
        'operator_sessions_session_digest_idx',
        'operator_sessions_xsrf_digest_idx',
        'verified_backups_created_idx',
        'verified_backups_name_idx',
      ];
      const requiredColumns = {
        fcm_metrics_hourly: [
          'hour',
          'platform',
          'attempted',
          'accepted',
          'permanently_rejected',
          'transient_failure',
          'latency_under_100',
          'latency_100_to_249',
          'latency_250_to_499',
          'latency_500_to_999',
          'latency_1000_to_2499',
          'latency_2500_to_4999',
          'latency_5000_to_9999',
          'latency_10000_or_more',
        ],
        oidc_login_attempts: [
          'state_digest',
          'cookie_digest',
          'code_verifier',
          'nonce',
          'expires_at',
        ],
        operation_leases: [
          'kind',
          'lease_id',
          'acquired_at',
          'lease_expires_at',
          'cooldown_ends_at',
        ],
        operation_results: [
          'kind',
          'lease_id',
          'completed_at',
          'outcome',
          'reason',
        ],
        operator_audit_entries: [
          'id',
          'occurred_at',
          'issuer',
          'subject',
          'kind',
          'outcome',
          'reason',
        ],
        operator_identities: [
          'issuer',
          'subject',
          'display_name',
          'email',
          'created_at',
          'updated_at',
        ],
        operator_sessions: [
          'id',
          'session_digest',
          'xsrf_digest',
          'issuer',
          'subject',
          'created_at',
          'last_seen_at',
          'idle_expires_at',
          'absolute_expires_at',
          'policy_fingerprint',
          'revoked_at',
        ],
        request_metrics_hourly: [
          'hour',
          'processed',
          'invalid',
          'rate_limited',
          'safety_budget_exhausted',
          'storage_unavailable',
        ],
        verified_backups: [
          'id',
          'name',
          'created_at',
          'size_bytes',
          'sha256',
          'issuer',
          'subject',
        ],
      } as const;
      const hasSchemaObject = (
        type: 'index' | 'table',
        name: string,
      ): boolean =>
        this.database
          .query<{ readonly present: number }, [string, string]>(
            `SELECT 1 AS present
             FROM sqlite_master
             WHERE type = ?1 AND name = ?2
             LIMIT 1`,
          )
          .get(type, name)?.present === 1;
      const columnsReady = Object.entries(requiredColumns).every(
        ([table, expectedColumns]) => {
          const actualColumns = this.database
            .query<{ readonly name: string }, [string]>(
              'SELECT name FROM pragma_table_info(?1) ORDER BY cid',
            )
            .all(table)
            .map(({ name }) => name);
          return expectedColumns.every((name) => actualColumns.includes(name));
        },
      );
      const pragmasReady =
        this.database
          .query<{ readonly foreign_keys: number }, []>('PRAGMA foreign_keys')
          .get()?.foreign_keys === 1 &&
        this.database
          .query<{ readonly timeout: number }, []>('PRAGMA busy_timeout')
          .get()?.timeout === ADMIN_BUSY_TIMEOUT_MS &&
        this.database
          .query<{ readonly journal_mode: string }, []>('PRAGMA journal_mode')
          .get()
          ?.journal_mode.toLowerCase() === 'wal' &&
        this.database
          .query<{ readonly synchronous: number }, []>('PRAGMA synchronous')
          .get()?.synchronous === 2;
      if (
        !migrationsReady ||
        !migrationsCompatible ||
        !requiredTables.every((name) => hasSchemaObject('table', name)) ||
        !requiredIndexes.every((name) => hasSchemaObject('index', name)) ||
        !columnsReady ||
        !pragmasReady
      ) {
        return Promise.resolve(false);
      }

      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  private insertAudit(
    kind: typeof operatorAuditEntries.$inferInsert.kind,
    outcome: typeof operatorAuditEntries.$inferInsert.outcome,
    occurredAt: number,
    identity?: Pick<AdminOperatorIdentity, 'issuer' | 'subject'>,
    reason?: string,
  ): void {
    this.queryDatabase
      .insert(operatorAuditEntries)
      .values({
        id: crypto.randomUUID(),
        kind,
        occurredAt,
        outcome,
        ...(reason === undefined ? {} : { reason }),
        ...(identity === undefined
          ? { issuer: null, subject: null }
          : { issuer: identity.issuer, subject: identity.subject }),
      })
      .run();
  }

  private revokeInactiveSessions(
    nowSeconds: number,
    currentPolicyFingerprint: string,
  ): void {
    const candidates = this.queryDatabase
      .select({ identity: operatorIdentities, session: operatorSessions })
      .from(operatorSessions)
      .innerJoin(
        operatorIdentities,
        and(
          eq(operatorSessions.issuer, operatorIdentities.issuer),
          eq(operatorSessions.subject, operatorIdentities.subject),
        ),
      )
      .where(isNull(operatorSessions.revokedAt))
      .all();
    for (const candidate of candidates) {
      const reason = inactiveReason(
        candidate.session,
        nowSeconds,
        currentPolicyFingerprint,
      );
      if (reason === 'missing' || reason === 'revoked') {
        continue;
      }
      this.queryDatabase
        .update(operatorSessions)
        .set({ revokedAt: Math.max(nowSeconds, candidate.session.createdAt) })
        .where(
          and(
            eq(operatorSessions.id, candidate.session.id),
            isNull(operatorSessions.revokedAt),
          ),
        )
        .run();
      this.insertAudit(
        reason === 'policy_changed' ? 'policy_rejected' : 'session_expired',
        'succeeded',
        nowSeconds,
        identityFrom(candidate.identity),
        reason,
      );
    }
  }
}
