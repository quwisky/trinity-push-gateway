import { createHmac, timingSafeEqual } from 'node:crypto';

import * as z from 'zod/mini';

import { ADMIN_AUDIT_PAGE_SCHEMA, validatedAdminResponse } from './contract';
import { ADMIN_AUDIT_KINDS, ADMIN_AUDIT_OUTCOMES } from './schema';

const DEFAULT_RANGE_SECONDS = 24 * 60 * 60;
const MAXIMUM_RANGE_SECONDS = 90 * 24 * 60 * 60;
const DEFAULT_PAGE_SIZE = 50;
const MAXIMUM_PAGE_SIZE = 100;
const CURSOR_LIFETIME_SECONDS = 15 * 60;
const MAXIMUM_CURSOR_LENGTH = 2_048;

const SAFE_NONNEGATIVE_INTEGER = z
  .number()
  .check(z.int(), z.nonnegative(), z.lte(Number.MAX_SAFE_INTEGER));
const AUDIT_KIND_SCHEMA = z.enum(ADMIN_AUDIT_KINDS);
const AUDIT_OUTCOME_SCHEMA = z.enum(ADMIN_AUDIT_OUTCOMES);
const AUDIT_QUERY_PARAMETER_SCHEMA = z.strictObject({
  cursor: z.optional(
    z.string().check(z.minLength(1), z.maxLength(MAXIMUM_CURSOR_LENGTH)),
  ),
  from: z.optional(z.iso.datetime()),
  kind: z.optional(AUDIT_KIND_SCHEMA),
  limit: z.optional(z.string().check(z.regex(/^[1-9][0-9]{0,2}$/u))),
  outcome: z.optional(AUDIT_OUTCOME_SCHEMA),
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
    kind: z.nullable(AUDIT_KIND_SCHEMA),
    limit: z.number().check(z.int(), z.gte(1), z.lte(MAXIMUM_PAGE_SIZE)),
    outcome: z.nullable(AUDIT_OUTCOME_SCHEMA),
    to: SAFE_NONNEGATIVE_INTEGER,
  }),
  version: z.literal(1),
});

type AuditEntryKind = (typeof ADMIN_AUDIT_KINDS)[number];
type AuditEntryOutcome = (typeof ADMIN_AUDIT_OUTCOMES)[number];
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
  reason: string | null;
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
      page: z.output<typeof ADMIN_AUDIT_PAGE_SCHEMA>;
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
      ? (cursor?.filter.from ?? to - DEFAULT_RANGE_SECONDS)
      : timestampSeconds(parameters.from);
  const limit =
    parameters.limit === undefined
      ? (cursor?.filter.limit ?? DEFAULT_PAGE_SIZE)
      : Number(parameters.limit);
  const kind = parameters.kind ?? cursor?.filter.kind ?? undefined;
  const outcome = parameters.outcome ?? cursor?.filter.outcome ?? undefined;
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to - from > MAXIMUM_RANGE_SECONDS ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAXIMUM_PAGE_SIZE
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
                cursor?.expiresAt ?? nowSeconds + CURSOR_LIFETIME_SECONDS,
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
        page: validatedAdminResponse(ADMIN_AUDIT_PAGE_SCHEMA, {
          entries: pageEntries.map(projectEntry),
          ...(nextCursor === undefined ? {} : { nextCursor }),
        }),
      };
    },
  };
}
