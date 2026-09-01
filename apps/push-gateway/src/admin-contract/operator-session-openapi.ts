import { OPERATOR_SESSION_LIST_RESPONSE_SCHEMA } from './operator-session';
import { adminContractOpenApiComponents, type JsonValue } from './openapi';

const COMPONENT_ORDER = [
  'UtcTimestamp',
  'OpaqueId',
  'OperatorIdentity',
  'OperatorSession',
  'OperatorSessionList',
] as const;

export function operatorSessionOpenApiComponents(): Readonly<
  Record<(typeof COMPONENT_ORDER)[number], JsonValue>
> {
  return adminContractOpenApiComponents(
    OPERATOR_SESSION_LIST_RESPONSE_SCHEMA,
    COMPONENT_ORDER,
  );
}
