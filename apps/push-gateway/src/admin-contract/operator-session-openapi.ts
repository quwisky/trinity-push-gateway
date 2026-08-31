import * as z from 'zod/mini';

import {
  OPERATOR_SESSION_CONTRACT_REGISTRY,
  OPERATOR_SESSION_RESPONSE_SCHEMA,
} from './operator-session';

type JsonObject = {
  readonly [key: string]: JsonValue;
};

type JsonValue = boolean | JsonObject | null | number | string | JsonValue[];

const SHARED_COMPONENTS = new Set([
  'OpaqueId',
  'OperatorIdentity',
  'UtcTimestamp',
]);
const COMPONENT_ORDER = [
  'UtcTimestamp',
  'OpaqueId',
  'OperatorIdentity',
  'OperatorSession',
] as const;

function componentReferences(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(componentReferences);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key !== '$ref' || typeof entry !== 'string') {
        return [key, componentReferences(entry)];
      }
      const definition = /^#\/\$defs\/(.+)$/u.exec(entry)?.[1];
      if (definition === undefined || !SHARED_COMPONENTS.has(definition)) {
        throw new Error(
          `Unsupported Operator Session schema reference: ${entry}`,
        );
      }
      return [key, `#/components/schemas/${definition}`];
    }),
  );
}

export function operatorSessionOpenApiComponents(): Readonly<
  Record<(typeof COMPONENT_ORDER)[number], JsonValue>
> {
  const document = z.toJSONSchema(OPERATOR_SESSION_RESPONSE_SCHEMA, {
    metadata: OPERATOR_SESSION_CONTRACT_REGISTRY,
    reused: 'ref',
  });
  const definitions = document.$defs as
    Readonly<Record<string, JsonValue>> | undefined;
  return Object.fromEntries(
    COMPONENT_ORDER.map((name) => {
      const definition = definitions?.[name];
      if (
        definition === undefined ||
        definition === null ||
        Array.isArray(definition) ||
        typeof definition !== 'object'
      ) {
        throw new Error(
          `Canonical Operator Session schema definition is missing: ${name}.`,
        );
      }
      return [name, componentReferences(definition)];
    }),
  ) as Readonly<Record<(typeof COMPONENT_ORDER)[number], JsonValue>>;
}
