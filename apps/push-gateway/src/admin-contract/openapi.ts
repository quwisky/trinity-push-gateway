import * as z from 'zod/mini';

import { ADMIN_CONTRACT_REGISTRY } from './shared';

export type JsonObject = {
  readonly [key: string]: JsonValue;
};

export type JsonValue =
  boolean | JsonObject | JsonValue[] | null | number | string;

function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function collapseNullableType(document: JsonObject): JsonObject {
  const alternatives = document.anyOf;
  if (!Array.isArray(alternatives) || alternatives.length !== 2) {
    return document;
  }
  const nullAlternative = alternatives.find(
    (alternative): alternative is JsonObject =>
      isJsonObject(alternative) &&
      alternative.type === 'null' &&
      Object.keys(alternative).length === 1,
  );
  const valueAlternative = alternatives.find(
    (alternative): alternative is JsonObject =>
      isJsonObject(alternative) &&
      typeof alternative.type === 'string' &&
      alternative.type !== 'null',
  );
  if (
    nullAlternative === undefined ||
    valueAlternative === undefined ||
    typeof valueAlternative.type !== 'string'
  ) {
    return document;
  }

  const outer = Object.fromEntries(
    Object.entries(document).filter(([key]) => key !== 'anyOf'),
  );
  const valueConstraints = Object.fromEntries(
    Object.entries(valueAlternative).filter(([key]) => key !== 'type'),
  );
  return {
    type: [valueAlternative.type, 'null'],
    ...valueConstraints,
    ...outer,
  };
}

function componentReferences(
  value: JsonValue,
  supportedComponents: ReadonlySet<string>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      componentReferences(entry, supportedComponents),
    );
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }

  return collapseNullableType(
    Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (key !== '$ref' || typeof entry !== 'string') {
          return [key, componentReferences(entry, supportedComponents)];
        }
        const definition = /^#\/\$defs\/(.+)$/u.exec(entry)?.[1];
        if (definition === undefined || !supportedComponents.has(definition)) {
          throw new Error(
            `Unsupported administration schema reference: ${entry}`,
          );
        }
        return [key, `#/components/schemas/${definition}`];
      }),
    ),
  );
}

export function adminContractOpenApiComponents<
  const ComponentName extends string,
>(
  schema: z.ZodMiniType,
  componentOrder: readonly ComponentName[],
  externalComponents: readonly string[] = [],
): Readonly<Record<ComponentName, JsonValue>> {
  const document = z.toJSONSchema(schema, {
    metadata: ADMIN_CONTRACT_REGISTRY,
    reused: 'inline',
  });
  const definitions = document.$defs as
    Readonly<Record<string, JsonValue>> | undefined;
  const supportedComponents = new Set([
    ...componentOrder,
    ...externalComponents,
  ]);

  return Object.fromEntries(
    componentOrder.map((name) => {
      const definition = definitions?.[name];
      if (
        definition === undefined ||
        definition === null ||
        Array.isArray(definition) ||
        typeof definition !== 'object'
      ) {
        throw new Error(
          `Canonical administration schema definition is missing: ${name}.`,
        );
      }
      return [
        name,
        componentReferences(definition, supportedComponents),
      ] as const;
    }),
  ) as Readonly<Record<ComponentName, JsonValue>>;
}
