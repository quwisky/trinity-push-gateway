import { Database } from 'bun:sqlite';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import type {
  OidcLoginAttempt,
  OidcLoginAttemptStore,
  OperatorIdentityProjection,
} from '../../../../src/bun/auth/oidc-client';
import {
  OPERATOR_SESSION_POLICY,
  selectOperatorSessionEvictions,
  type OperatorSession,
} from '../../../../src/bun/auth/session-policy';

const loginAttempts = sqliteTable('login_attempts_spike', {
  codeVerifier: text('code_verifier').notNull(),
  expiresAt: integer('expires_at').notNull(),
  nonce: text('nonce').notNull(),
  stateDigest: text('state_digest').primaryKey(),
});

const operatorIdentities = sqliteTable(
  'operator_identities_spike',
  {
    displayName: text('display_name'),
    email: text('email'),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
  },
  (table) => [primaryKey({ columns: [table.issuer, table.subject] })],
);

const operatorSessions = sqliteTable('operator_sessions_spike', {
  absoluteExpiresAt: integer('absolute_expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  id: text('id').primaryKey(),
  idleExpiresAt: integer('idle_expires_at').notNull(),
  issuer: text('issuer').notNull(),
  policyFingerprint: text('policy_fingerprint').notNull(),
  revokedAt: integer('revoked_at'),
  subject: text('subject').notNull(),
  xsrfToken: text('xsrf_token').notNull(),
});

const spikeSchema = { loginAttempts, operatorIdentities, operatorSessions };
type SpikeSchema = typeof spikeSchema;

export type AuthWriteFailurePoint = 'after_identity' | 'after_session';

type EstablishSessionOptions = {
  readonly failurePoint?: AuthWriteFailurePoint;
  readonly id: string;
  readonly nowSeconds: number;
  readonly policyFingerprint: string;
  readonly xsrfToken: string;
};

type SpikeSnapshot = {
  readonly identities: readonly {
    readonly displayName: string | null;
    readonly email: string | null;
    readonly issuer: string;
    readonly subject: string;
  }[];
  readonly loginAttempts: readonly OidcLoginAttempt[];
  readonly sessions: readonly {
    readonly absoluteExpiresAt: number;
    readonly createdAt: number;
    readonly id: string;
    readonly idleExpiresAt: number;
    readonly issuer: string;
    readonly policyFingerprint: string;
    readonly revokedAt: number | null;
    readonly subject: string;
    readonly xsrfToken: string;
  }[];
};

function configure(database: Database): void {
  database.run('PRAGMA foreign_keys = ON');
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA synchronous = FULL');
  database.run(`CREATE TABLE IF NOT EXISTS login_attempts_spike (
    state_digest TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) WITHOUT ROWID`);
  database.run(`CREATE TABLE IF NOT EXISTS operator_identities_spike (
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    display_name TEXT,
    email TEXT,
    PRIMARY KEY (issuer, subject)
  ) WITHOUT ROWID`);
  database.run(`CREATE TABLE IF NOT EXISTS operator_sessions_spike (
    id TEXT PRIMARY KEY,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    idle_expires_at INTEGER NOT NULL,
    absolute_expires_at INTEGER NOT NULL,
    policy_fingerprint TEXT NOT NULL,
    xsrf_token TEXT NOT NULL,
    revoked_at INTEGER
  ) WITHOUT ROWID`);
}

function injectFailure(
  expected: AuthWriteFailurePoint | undefined,
  actual: AuthWriteFailurePoint,
): void {
  if (expected === actual) {
    throw new Error('Injected auth write failure.');
  }
}

export class SqliteAuthSpikeHarness implements OidcLoginAttemptStore {
  private readonly queryDatabase: BunSQLiteDatabase<SpikeSchema>;

  private constructor(private readonly database: Database) {
    this.queryDatabase = drizzle(database, { schema: spikeSchema });
  }

  static open(databasePath: string): SqliteAuthSpikeHarness {
    const database = new Database(databasePath, { create: true, strict: true });
    configure(database);
    return new SqliteAuthSpikeHarness(database);
  }

  close(): void {
    this.database.close(true);
  }

  consume(
    stateDigest: string,
    nowSeconds: number,
  ): Promise<OidcLoginAttempt | undefined> {
    const attempt = this.queryDatabase
      .delete(loginAttempts)
      .where(eq(loginAttempts.stateDigest, stateDigest))
      .returning()
      .get();
    return Promise.resolve(
      attempt !== undefined && nowSeconds < attempt.expiresAt
        ? attempt
        : undefined,
    );
  }

  establishSession(
    identity: OperatorIdentityProjection,
    options: EstablishSessionOptions,
  ): void {
    this.queryDatabase.transaction((transaction) => {
      transaction
        .insert(operatorIdentities)
        .values({
          displayName: identity.displayName ?? null,
          email: identity.email ?? null,
          issuer: identity.issuer,
          subject: identity.subject,
        })
        .onConflictDoUpdate({
          set: {
            displayName: identity.displayName ?? null,
            email: identity.email ?? null,
          },
          target: [operatorIdentities.issuer, operatorIdentities.subject],
        })
        .run();
      injectFailure(options.failurePoint, 'after_identity');

      const currentSessions: OperatorSession[] = transaction
        .select()
        .from(operatorSessions)
        .all()
        .map((session) => ({
          absoluteExpiresAt: session.absoluteExpiresAt,
          createdAt: session.createdAt,
          id: session.id,
          identity: { issuer: session.issuer, subject: session.subject },
          idleExpiresAt: session.idleExpiresAt,
          policyFingerprint: session.policyFingerprint,
          revokedAt: session.revokedAt ?? undefined,
          xsrfToken: session.xsrfToken,
        }));
      const evictions = selectOperatorSessionEvictions(currentSessions, {
        issuer: identity.issuer,
        subject: identity.subject,
      });
      if (evictions.length > 0) {
        transaction
          .delete(operatorSessions)
          .where(inArray(operatorSessions.id, [...evictions]))
          .run();
      }
      transaction
        .insert(operatorSessions)
        .values({
          absoluteExpiresAt:
            options.nowSeconds + OPERATOR_SESSION_POLICY.absoluteSeconds,
          createdAt: options.nowSeconds,
          id: options.id,
          idleExpiresAt:
            options.nowSeconds + OPERATOR_SESSION_POLICY.idleSeconds,
          issuer: identity.issuer,
          policyFingerprint: options.policyFingerprint,
          revokedAt: null,
          subject: identity.subject,
          xsrfToken: options.xsrfToken,
        })
        .run();
      injectFailure(options.failurePoint, 'after_session');
    });
  }

  save(attempt: OidcLoginAttempt): Promise<void> {
    this.queryDatabase.insert(loginAttempts).values(attempt).run();
    return Promise.resolve();
  }

  revokeSession(id: string, nowSeconds: number): boolean {
    return (
      this.queryDatabase
        .update(operatorSessions)
        .set({ revokedAt: nowSeconds })
        .where(
          and(eq(operatorSessions.id, id), isNull(operatorSessions.revokedAt)),
        )
        .returning({ id: operatorSessions.id })
        .all().length === 1
    );
  }

  snapshot(): SpikeSnapshot {
    return {
      identities: this.queryDatabase
        .select()
        .from(operatorIdentities)
        .orderBy(operatorIdentities.issuer, operatorIdentities.subject)
        .all(),
      loginAttempts: this.queryDatabase
        .select()
        .from(loginAttempts)
        .orderBy(loginAttempts.stateDigest)
        .all(),
      sessions: this.queryDatabase
        .select()
        .from(operatorSessions)
        .orderBy(operatorSessions.createdAt, operatorSessions.id)
        .all(),
    };
  }
}
