import * as z from 'zod/mini';

import {
  ADMIN_PROBLEM_CATALOG,
  ADMIN_PROBLEM_SCHEMA,
  type AdminProblemCode,
  AUDIT_QUERY_POLICY,
  BACKUP_LIST_SCHEMA,
  OPERATION_RESULT_SCHEMA,
  OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA,
} from './operator-actions';
import { adminContractOpenApiComponents, type JsonValue } from './openapi';

const COMPONENT_ORDER = [
  'OperationSummaryReason',
  'OperationResultOutcome',
  'OperationResult',
  'AuditEntryKind',
  'AuditEntryOutcome',
  'AuditEntryReason',
  'OperatorAuditEntry',
  'OperatorAuditEntryPage',
  'BackupIntegrity',
  'Backup',
  'BackupList',
  'Problem',
] as const;

const OPERATOR_ACTION_RESPONSES_SCHEMA = z.strictObject({
  audit: OPERATOR_AUDIT_ENTRY_PAGE_SCHEMA,
  backups: BACKUP_LIST_SCHEMA,
  operation: OPERATION_RESULT_SCHEMA,
  problem: ADMIN_PROBLEM_SCHEMA,
});

export function operatorActionsOpenApiComponents(): Readonly<
  Record<(typeof COMPONENT_ORDER)[number], JsonValue>
> {
  return adminContractOpenApiComponents(
    OPERATOR_ACTION_RESPONSES_SCHEMA,
    COMPONENT_ORDER,
    ['UtcTimestamp', 'OpaqueId', 'OperatorIdentity', 'PositiveSafeInteger'],
  );
}

type AdminProblemResponseName =
  | 'AdminUnavailable'
  | 'BackupLimitExceeded'
  | 'CooldownActive'
  | 'Forbidden'
  | 'InvalidRequest'
  | 'MutationForbidden'
  | 'NotFound'
  | 'OperationInProgress'
  | 'OperationTimeout'
  | 'OutcomeUnknown'
  | 'Unauthenticated';

function exactProblemSchema(code: AdminProblemCode): JsonValue {
  const definition = ADMIN_PROBLEM_CATALOG[code];
  return {
    allOf: [
      { $ref: '#/components/schemas/Problem' },
      {
        type: 'object',
        properties: {
          type: { const: `/admin/problems/${code}` },
          title: { const: definition.title },
          status: { const: definition.status },
          code: { const: code },
        },
        required: ['type', 'title', 'status', 'code'],
      },
    ],
  };
}

function problemResponse(
  description: string,
  codes: readonly [AdminProblemCode, ...AdminProblemCode[]],
  headers?: JsonValue,
): JsonValue {
  const firstSchema = exactProblemSchema(codes[0]);
  const remainingSchemas = codes.slice(1).map(exactProblemSchema);
  return {
    description,
    ...(headers === undefined ? {} : { headers }),
    content: {
      'application/problem+json': {
        schema:
          remainingSchemas.length === 0
            ? firstSchema
            : { oneOf: [firstSchema, ...remainingSchemas] },
      },
    },
  };
}

export function adminProblemOpenApiResponses(): Readonly<
  Record<AdminProblemResponseName, JsonValue>
> {
  return {
    InvalidRequest: problemResponse(
      'Request parameters are invalid (`invalid_request`).',
      ['invalid_request'],
    ),
    Unauthenticated: problemResponse(
      'The Operator Session is absent, invalid, revoked, or expired (`unauthenticated`).',
      ['unauthenticated'],
    ),
    Forbidden: problemResponse(
      'The authenticated Operator Identity is not permitted (`forbidden`).',
      ['forbidden'],
    ),
    MutationForbidden: problemResponse(
      'The Operator Identity is forbidden (`forbidden`), or exact-Origin or XSRF validation failed (`csrf_failed`).',
      ['forbidden', 'csrf_failed'],
    ),
    NotFound: problemResponse(
      'The requested fixed resource does not exist (`not_found`).',
      ['not_found'],
    ),
    OperationInProgress: problemResponse(
      'A mutually exclusive maintenance action is already running (`operation_in_progress`).',
      ['operation_in_progress'],
    ),
    CooldownActive: problemResponse(
      'The action is still in its fixed cooldown (`cooldown_active`).',
      ['cooldown_active'],
      { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } },
    ),
    OutcomeUnknown: problemResponse(
      'The action executed but its final audit state could not be persisted; clients must not retry automatically (`outcome_unknown`).',
      ['outcome_unknown'],
    ),
    AdminUnavailable: problemResponse(
      'The isolated administration subsystem is unavailable (`admin_unavailable`).',
      ['admin_unavailable'],
    ),
    OperationTimeout: problemResponse(
      'The bounded action exceeded its fixed deadline (`operation_timeout`).',
      ['operation_timeout'],
    ),
    BackupLimitExceeded: problemResponse(
      'The configured backup count or byte limit prevents another backup; operator intervention is required (`backup_limit_exceeded`).',
      ['backup_limit_exceeded'],
    ),
  };
}

const maximumRangeDescription = `The maximum range is ${String(AUDIT_QUERY_POLICY.maximumRangeDays)} days.`;

export function operatorAuditOpenApiParameters(): Readonly<
  Record<
    | 'AuditCursor'
    | 'AuditEntryKindFilter'
    | 'AuditEntryOutcomeFilter'
    | 'AuditFrom'
    | 'AuditLimit'
    | 'AuditTo',
    JsonValue
  >
> {
  return {
    AuditCursor: {
      name: 'cursor',
      in: 'query',
      required: false,
      description:
        'Opaque continuation cursor from `nextCursor`. It binds every effective filter and must be replayed without interpretation or modification.',
      schema: {
        type: 'string',
        minLength: 1,
        maxLength: AUDIT_QUERY_POLICY.maximumCursorLength,
      },
    },
    AuditLimit: {
      name: 'limit',
      in: 'query',
      required: false,
      description: `Maximum entries in the page. Defaults to ${String(AUDIT_QUERY_POLICY.defaultPageSize)} and cannot exceed ${String(AUDIT_QUERY_POLICY.maximumPageSize)}.`,
      schema: {
        type: 'integer',
        minimum: 1,
        maximum: AUDIT_QUERY_POLICY.maximumPageSize,
        default: AUDIT_QUERY_POLICY.defaultPageSize,
      },
    },
    AuditEntryKindFilter: {
      name: 'kind',
      in: 'query',
      required: false,
      description: 'Include only entries with this fixed audit-entry kind.',
      schema: { $ref: '#/components/schemas/AuditEntryKind' },
    },
    AuditEntryOutcomeFilter: {
      name: 'outcome',
      in: 'query',
      required: false,
      description: 'Include only entries with this fixed audit outcome.',
      schema: { $ref: '#/components/schemas/AuditEntryOutcome' },
    },
    AuditFrom: {
      name: 'from',
      in: 'query',
      required: false,
      description: `Inclusive UTC start of the audit range. \`from\` and \`to\` must either both be omitted or both be supplied. ${maximumRangeDescription}`,
      schema: { $ref: '#/components/schemas/UtcTimestamp' },
    },
    AuditTo: {
      name: 'to',
      in: 'query',
      required: false,
      description: `Exclusive UTC end of the audit range. \`from\` and \`to\` must either both be omitted or both be supplied. ${maximumRangeDescription}`,
      schema: { $ref: '#/components/schemas/UtcTimestamp' },
    },
  };
}
