import { describe, expect, it } from 'bun:test';

import {
  createOperatorAuditEntryQuery,
  type OperatorAuditEntryRecord,
  type OperatorAuditEntryQueryResult,
  type OperatorAuditEntryStorage,
  type OperatorAuditEntryStorageQuery,
} from '../../../src/bun/admin/audit-query';

const CURSOR_SECRET = 'audit-query-secret-sentinel-00000000';
const INITIAL_NOW_SECONDS = 1_700_000_000;

class ScriptedAuditStorage implements OperatorAuditEntryStorage {
  readonly calls: OperatorAuditEntryStorageQuery[] = [];
  private readonly pages: (readonly OperatorAuditEntryRecord[])[];

  constructor(...pages: readonly (readonly OperatorAuditEntryRecord[])[]) {
    this.pages = [...pages];
  }

  readOperatorAuditEntries(
    query: OperatorAuditEntryStorageQuery,
  ): readonly OperatorAuditEntryRecord[] {
    this.calls.push(query);
    return this.pages.shift() ?? [];
  }
}

function auditEntry(
  index: number,
  occurredAt = INITIAL_NOW_SECONDS - index,
  overrides: Partial<OperatorAuditEntryRecord> = {},
): OperatorAuditEntryRecord {
  return {
    id: `audit-entry-${index.toString().padStart(4, '0')}`,
    issuer: null,
    kind: 'login',
    occurredAt,
    outcome: 'succeeded',
    reason: null,
    subject: null,
    ...overrides,
  };
}

function utc(seconds: number): string {
  return new Date(seconds * 1_000).toISOString();
}

function pageCursor(result: OperatorAuditEntryQueryResult): string {
  expect(result.kind).toBe('page');
  if (result.kind !== 'page' || result.page.nextCursor === undefined) {
    throw new Error('Expected an Operator Audit Entry continuation cursor.');
  }
  return result.page.nextCursor;
}

describe('deep Operator Audit Entry query', () => {
  it('normalizes filters, owns storage access, and returns only the safe projection', () => {
    const sensitiveEntry = {
      ...auditEntry(1, INITIAL_NOW_SECONDS - 10, {
        issuer: 'https://issuer.example/',
        kind: 'cleanup',
        outcome: 'failed',
        reason: 'operation_timeout',
        subject: 'operator-1',
      }),
      accessToken: 'access-token-sentinel',
      matrixUserId: '@operator:example.test',
      rawClaims: { groups: ['gateway-operators'] },
    };
    const storage = new ScriptedAuditStorage([
      sensitiveEntry,
      auditEntry(2, INITIAL_NOW_SECONDS - 20, {
        kind: 'cleanup',
        outcome: 'failed',
      }),
    ]);
    const query = createOperatorAuditEntryQuery({
      cursorSecret: CURSOR_SECRET,
      nowSeconds: () => INITIAL_NOW_SECONDS,
      storage,
    });

    const result = query.query(
      new URLSearchParams({
        from: utc(INITIAL_NOW_SECONDS - 100),
        kind: 'cleanup',
        limit: '2',
        outcome: 'failed',
        to: utc(INITIAL_NOW_SECONDS),
      }),
    );

    expect(result).toEqual({
      kind: 'page',
      page: {
        entries: [
          {
            id: 'audit-entry-0001',
            kind: 'cleanup',
            occurredAt: utc(INITIAL_NOW_SECONDS - 10),
            operator: {
              issuer: 'https://issuer.example/',
              subject: 'operator-1',
            },
            outcome: 'failed',
            reason: 'operation_timeout',
          },
          {
            id: 'audit-entry-0002',
            kind: 'cleanup',
            occurredAt: utc(INITIAL_NOW_SECONDS - 20),
            operator: null,
            outcome: 'failed',
          },
        ],
      },
    });
    expect(storage.calls).toEqual([
      {
        from: INITIAL_NOW_SECONDS - 100,
        kind: 'cleanup',
        outcome: 'failed',
        take: 3,
        to: INITIAL_NOW_SECONDS,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('access-token-sentinel');
    expect(JSON.stringify(result)).not.toContain('@operator:example.test');
    expect(JSON.stringify(result)).not.toContain('gateway-operators');
  });

  it('rejects malformed query and range input before storage access', () => {
    const storage = new ScriptedAuditStorage();
    const query = createOperatorAuditEntryQuery({
      cursorSecret: CURSOR_SECRET,
      nowSeconds: () => INITIAL_NOW_SECONDS,
      storage,
    });
    const invalidQueries = [
      'unexpected=value',
      'limit=0',
      'limit=101',
      'limit=1&limit=2',
      `from=${encodeURIComponent(utc(INITIAL_NOW_SECONDS - 10))}`,
      `to=${encodeURIComponent(utc(INITIAL_NOW_SECONDS))}`,
      'from=not-a-timestamp&to=still-not-a-timestamp',
      `from=${encodeURIComponent(utc(INITIAL_NOW_SECONDS))}&to=${encodeURIComponent(utc(INITIAL_NOW_SECONDS - 1))}`,
      `from=${encodeURIComponent(utc(INITIAL_NOW_SECONDS - 91 * 86_400))}&to=${encodeURIComponent(utc(INITIAL_NOW_SECONDS))}`,
      'kind=not_an_audit_kind',
      'outcome=not_an_audit_outcome',
    ];

    for (const parameters of invalidQueries) {
      expect(query.query(new URLSearchParams(parameters))).toEqual({
        kind: 'invalid',
      });
    }
    expect(storage.calls).toEqual([]);
  });

  it('binds bounded cursor replay to the same storage boundary', () => {
    const occurredAt = INITIAL_NOW_SECONDS - 10;
    const storage = new ScriptedAuditStorage(
      [
        auditEntry(4, occurredAt),
        auditEntry(3, occurredAt),
        auditEntry(2, occurredAt),
      ],
      [auditEntry(2, occurredAt), auditEntry(1, occurredAt)],
      [auditEntry(2, occurredAt), auditEntry(1, occurredAt)],
    );
    const query = createOperatorAuditEntryQuery({
      cursorSecret: CURSOR_SECRET,
      nowSeconds: () => INITIAL_NOW_SECONDS,
      storage,
    });
    const first = query.query(new URLSearchParams({ limit: '2' }));
    const cursor = pageCursor(first);

    const replayedOnce = query.query(new URLSearchParams({ cursor }));
    const replayedTwice = query.query(new URLSearchParams({ cursor }));

    expect(replayedOnce).toEqual(replayedTwice);
    expect(replayedOnce).toMatchObject({
      kind: 'page',
      page: {
        entries: [{ id: 'audit-entry-0002' }, { id: 'audit-entry-0001' }],
      },
    });
    expect(storage.calls.slice(-2)).toEqual([
      {
        before: { id: 'audit-entry-0003', occurredAt },
        from: INITIAL_NOW_SECONDS - 86_400,
        take: 3,
        to: INITIAL_NOW_SECONDS,
      },
      {
        before: { id: 'audit-entry-0003', occurredAt },
        from: INITIAL_NOW_SECONDS - 86_400,
        take: 3,
        to: INITIAL_NOW_SECONDS,
      },
    ]);
  });

  it('rejects malformed, tampered, expired, rotated, and filter-mismatched cursors', () => {
    let nowSeconds = INITIAL_NOW_SECONDS;
    const storage = new ScriptedAuditStorage([auditEntry(3), auditEntry(2)]);
    const query = createOperatorAuditEntryQuery({
      cursorSecret: CURSOR_SECRET,
      nowSeconds: () => nowSeconds,
      storage,
    });
    const from = utc(INITIAL_NOW_SECONDS - 100);
    const to = utc(INITIAL_NOW_SECONDS);
    const cursor = pageCursor(
      query.query(
        new URLSearchParams({
          from,
          kind: 'login',
          limit: '1',
          outcome: 'succeeded',
          to,
        }),
      ),
    );
    const [encoded, signature] = cursor.split('.');
    if (encoded === undefined || signature === undefined) {
      throw new Error('Expected a signed cursor.');
    }
    const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
    const invalidCursors = [
      'not-a-cursor',
      `${encoded}.${signature}.extra`,
      `${encoded}.${tamperedSignature}`,
    ];
    for (const invalidCursor of invalidCursors) {
      expect(
        query.query(new URLSearchParams({ cursor: invalidCursor })),
      ).toEqual({ kind: 'invalid' });
    }
    for (const mismatched of [
      { cursor, limit: '2' },
      { cursor, kind: 'cleanup' },
      { cursor, outcome: 'failed' },
      {
        cursor,
        from: utc(INITIAL_NOW_SECONDS - 99),
        to,
      },
    ]) {
      expect(query.query(new URLSearchParams(mismatched))).toEqual({
        kind: 'invalid',
      });
    }
    const rotated = createOperatorAuditEntryQuery({
      cursorSecret: `${CURSOR_SECRET}-rotated`,
      nowSeconds: () => nowSeconds,
      storage,
    });
    expect(rotated.query(new URLSearchParams({ cursor }))).toEqual({
      kind: 'invalid',
    });
    nowSeconds += 15 * 60;
    expect(query.query(new URLSearchParams({ cursor }))).toEqual({
      kind: 'invalid',
    });
    expect(storage.calls).toHaveLength(1);
  });
});
