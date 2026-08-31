import * as z from 'zod/mini';

import {
  ADMIN_PROBLEM_SCHEMA,
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
  'ProblemCode',
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
