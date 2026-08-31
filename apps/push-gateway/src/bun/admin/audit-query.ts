import { createHmac, timingSafeEqual } from 'node:crypto';

import * as z from 'zod/mini';

import {
  type AuditEntryReason,
  AUDIT_ENTRY_KIND_SCHEMA,
  AUDIT_ENTRY_OUTCOME_SCHEMA,
  AUDIT_QUERY_POLICY,
  OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA,
  type OperatorAuditEntryPage,
} from '../../admin-contract/operator-actions';
import { validatedAdminResponse } from '../../admin-contract/shared';

const SAFE_NONNEGATIVE_INTEGER = z
  .number()
  .check(z.int(), z.nonnegative(), z.lte(Number.MAX_SAFE_INTEGER));
const AUDIT_QUERY_PARAMETER_SCHEMA = z.strictObject({
  cursor: z.optional(
    z
      .string()
      .check(
        z.minLength(1),
        z.maxLength(AUDIT_QUERY_POLICY.maximumCursorLength),
      ),
  ),
  from: z.optional(z.iso.datetime()),
  kind: z.optional(AUDIT_ENTRY_KIND_SCHEMA),
  limit: z.optional(z.string().check(z.regex(/^[1-9][0-9]{0,2}$/u))),
  outcome: z.optional(AUDIT_ENTRY_OUTCOME_SCHEMA),
  to: z.optional(z.iso.datetime()),
});
const AUDIT_CURSOR_SCHEMA = z.strictObject({
  before: z.strictObject({
    id: z.string().check(z.minLength(16), z.maxLength(128)),
    occurredAt: SAFE_NONNEGATIVE_INTEGER,
  }),
  expiresAt: SAFE_NONNEGATIVE_INTEGER,
  filter: z.strictObject({
    from: SAFE_NONNEGATIVE_INTEGER,
    kind: z.nullable(AUDIT_ENTRY_KIND_SCHEMA),
    limit: z
      .number()
      .check(z.int(), z.gte(1), z.lte(AUDIT_QUERY_POLICY.maximumPageSize)),
    outcome: z.nullable(AUDIT_ENTRY_OUTCOME_SCHEMA),
    to: SAFE_NONNEGATIVE_INTEGER,
  }),
  version: z.literal(1),
});

type AuditEntryKind = z.infer<typeof AUDIT_ENTRY_KIND_SCHEMA>;
type AuditEntryOutcome = z.infer<typeof AUDIT_ENTRY_OUTCOME_SCHEMA>;
type AuditQueryParameters = z.output<typeof AUDIT_QUERY_PARAMETER_SCHEMA>;
type AuditCursor = z.output<typeof AUDIT_CURSOR_SCHEMA>;
type AuditFilter = Readonly<{
  from: number;
  kind?: AuditEntryKind;
  limit: number;
  outcome?: AuditEntryOutcome;
  to: number;
}>;

export type OperatorAuditEntryRecord = Readonly<{
  id: string;
  issuer: string | null;
  kind: AuditEntryKind;
  occurredAt: number;
  outcome: AuditEntryOutcome;
  reason: AuditEntryReason | null;
  subject: string | null;
}>;

export type OperatorAuditEntryStorageQuery = Readonly<{
  before?: Readonly<{ id: string; occurredAt: number }>;
  from: number;
  kind?: AuditEntryKind;
  outcome?: AuditEntryOutcome;
  take: number;
  to: number;
}>;

export type OperatorAuditEntryStorage = Readonly<{
  /**
   * Reads at most `take` records in descending occurred-at and identifier order.
   */
  readOperatorAuditEntries(
    query: OperatorAuditEntryStorageQuery,
  ): readonly OperatorAuditEntryRecord[];
}>;

export type OperatorAuditEntryQueryResult =
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{
      kind: 'page';
      page: OperatorAuditEntryPage;
    }>;

export type OperatorAuditEntryQuery = Readonly<{
  query(parameters: URLSearchParams): OperatorAuditEntryQueryResult;
}>;

type OperatorAuditEntryQueryOptions = Readonly<{
  cursorSecret: string;
  nowSeconds: () => number;
  storage: OperatorAuditEntryStorage;
}>;

function timestampSeconds(value: string): number {
  return Math.floor(Date.parse(value) / 1_000);
}

function readParameters(
  parameters: URLSearchParams,
): AuditQueryParameters | undefined {
  const values = Object.create(null) as Record<string, string>;
  for (const [name, value] of parameters) {
    if (Object.hasOwn(values, name)) return undefined;
    values[name] = value;
  }
  const parsed = z.safeParse(AUDIT_QUERY_PARAMETER_SCHEMA, values);
  return parsed.success ? parsed.data : undefined;
}

function cursorBindsFilter(cursor: AuditCursor, filter: AuditFilter): boolean {
  return (
    cursor.filter.from === filter.from &&
    cursor.filter.kind === (filter.kind ?? null) &&
    cursor.filter.limit === filter.limit &&
    cursor.filter.outcome === (filter.outcome ?? null) &&
    cursor.filter.to === filter.to
  );
}

function normalizeFilter(
  parameters: AuditQueryParameters,
  cursor: AuditCursor | undefined,
  nowSeconds: number,
): AuditFilter | undefined {
  if ((parameters.from === undefined) !== (parameters.to === undefined)) {
    return undefined;
  }
  const to =
    parameters.to === undefined
      ? (cursor?.filter.to ?? nowSeconds)
      : timestampSeconds(parameters.to);
  const from =
    parameters.from === undefined
      ? (cursor?.filter.from ?? to - AUDIT_QUERY_POLICY.defaultRangeSeconds)
      : timestampSeconds(parameters.from);
  const limit =
    parameters.limit === undefined
      ? (cursor?.filter.limit ?? AUDIT_QUERY_POLICY.defaultPageSize)
      : Number(parameters.limit);
  const kind = parameters.kind ?? cursor?.filter.kind ?? undefined;
  const outcome = parameters.outcome ?? cursor?.filter.outcome ?? undefined;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to - from > AUDIT_QUERY_POLICY.maximumRangeSeconds ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > AUDIT_QUERY_POLICY.maximumPageSize
  ) {
    return undefined;
  }
  return {
    from,
    ...(kind === undefined ? {} : { kind }),
    limit,
    ...(outcome === undefined ? {} : { outcome }),
    to,
  };
}

function cursorDigest(secret: string, encoded: string): Buffer {
  return createHmac('sha256', secret)
    .update('trinity-push-gateway-admin\0audit-cursor\0')
    .update(encoded)
    .digest();
}

function encodeCursor(secret: string, cursor: AuditCursor): string {
  const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64url');
  return `${encoded}.${cursorDigest(secret, encoded).toString('base64url')}`;
}

function canonicalBase64Url(value: string): Buffer | undefined {
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : undefined;
}

function decodeCursor(
  secret: string,
  value: string | undefined,
  nowSeconds: number,
): AuditCursor | undefined {
  if (value === undefined) return undefined;
  const [encoded, signature, extra] = value.split('.');
  if (encoded === undefined || signature === undefined || extra !== undefined) {
    return undefined;
  }
  const encodedBytes = canonicalBase64Url(encoded);
  const signatureBytes = canonicalBase64Url(signature);
  const expectedSignature = cursorDigest(secret, encoded);
  if (
    encodedBytes === undefined ||
    signatureBytes?.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(signatureBytes, expectedSignature)
  ) {
    return undefined;
  }
  try {
    const parsed = z.safeParse(
      AUDIT_CURSOR_SCHEMA,
      JSON.parse(encodedBytes.toString('utf8')),
    );
    return parsed.success && parsed.data.expiresAt > nowSeconds
      ? parsed.data
      : undefined;
  } catch {
    return undefined;
  }
}

function projectEntry(entry: OperatorAuditEntryRecord): unknown {
  return {
    id: entry.id,
    kind: entry.kind,
    occurredAt: new Date(entry.occurredAt * 1_000).toISOString(),
    operator:
      entry.issuer === null || entry.subject === null
        ? null
        : { issuer: entry.issuer, subject: entry.subject },
    outcome: entry.outcome,
    ...(entry.reason === null ? {} : { reason: entry.reason }),
  };
}

export function createOperatorAuditEntryQuery(
  options: OperatorAuditEntryQueryOptions,
): OperatorAuditEntryQuery {
  return {
    query(parameters): OperatorAuditEntryQueryResult {
      const nowSeconds = options.nowSeconds();
      const parsedParameters = readParameters(parameters);
      if (parsedParameters === undefined) return { kind: 'invalid' };
      const cursor = decodeCursor(
        options.cursorSecret,
        parsedParameters.cursor,
        nowSeconds,
      );
      if (parsedParameters.cursor !== undefined && cursor === undefined) {
        return { kind: 'invalid' };
      }
      const filter = normalizeFilter(parsedParameters, cursor, nowSeconds);
      if (
        filter === undefined ||
        (cursor !== undefined && !cursorBindsFilter(cursor, filter))
      ) {
        return { kind: 'invalid' };
      }
      const entries = options.storage.readOperatorAuditEntries({
        ...(cursor === undefined ? {} : { before: cursor.before }),
        from: filter.from,
        ...(filter.kind === undefined ? {} : { kind: filter.kind }),
        ...(filter.outcome === undefined ? {} : { outcome: filter.outcome }),
        take: filter.limit + 1,
        to: filter.to,
      });
      const pageEntries = entries.slice(0, filter.limit);
      const last = pageEntries.at(-1);
      const nextCursor =
        entries.length <= filter.limit || last === undefined
          ? undefined
          : encodeCursor(options.cursorSecret, {
              before: { id: last.id, occurredAt: last.occurredAt },
              expiresAt:
                cursor?.expiresAt ??
                nowSeconds + AUDIT_QUERY_POLICY.cursorLifetimeSeconds,
              filter: {
                from: filter.from,
                kind: filter.kind ?? null,
                limit: filter.limit,
                outcome: filter.outcome ?? null,
                to: filter.to,
              },
              version: 1,
            });
      return {
        kind: 'page',
        page: validatedAdminResponse(OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA, {
          entries: pageEntries.map(projectEntry),
          ...(nextCursor === undefined ? {} : { nextCursor }),
        }),
      };
    },
  };
}
