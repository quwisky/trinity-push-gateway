import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { configurationOpenApiComponents } from '../src/admin-contract/configuration-openapi';
import { operatorSessionOpenApiComponents } from '../src/admin-contract/operator-session-openapi';
import {
  ADMIN_PROBLEM_CATALOG,
  ADMIN_PROBLEM_FIELD_POLICY,
  AUDIT_ENTRY_KINDS,
  AUDIT_ENTRY_OUTCOMES,
  AUDIT_QUERY_POLICY,
} from '../src/admin-contract/operator-actions';
import {
  adminProblemOpenApiResponses,
  operatorActionsOpenApiComponents,
  operatorAuditOpenApiParameters,
} from '../src/admin-contract/operator-actions-openapi';
import { METRICS_QUERY_POLICY } from '../src/admin-contract/overview-metrics';
import {
  metricsOpenApiParameters,
  overviewMetricsOpenApiComponents,
} from '../src/admin-contract/overview-metrics-openapi';

const openApiPath = fileURLToPath(
  new URL('../openapi/admin-v1.yaml', import.meta.url),
);
const browserPolicyPath = fileURLToPath(
  new URL(
    '../../push-gateway-ui/src/app/api/admin-contract.generated.ts',
    import.meta.url,
  ),
);
type GeneratedContractBlock = Readonly<{
  content: Readonly<Record<string, unknown>>;
  endMarker: string;
  name: string;
  startMarker: string;
}>;

const GENERATED_CONTRACT_BLOCKS: readonly GeneratedContractBlock[] = [
  {
    content: adminProblemOpenApiResponses(),
    endMarker: '    # END GENERATED ADMIN PROBLEM RESPONSES',
    name: 'administration problem responses',
    startMarker: '    # BEGIN GENERATED ADMIN PROBLEM RESPONSES',
  },
  {
    content: metricsOpenApiParameters(),
    endMarker: '    # END GENERATED METRICS PARAMETERS',
    name: 'metrics parameters',
    startMarker: '    # BEGIN GENERATED METRICS PARAMETERS',
  },
  {
    content: operatorAuditOpenApiParameters(),
    endMarker: '    # END GENERATED AUDIT PARAMETERS',
    name: 'audit parameters',
    startMarker: '    # BEGIN GENERATED AUDIT PARAMETERS',
  },
  {
    content: operatorSessionOpenApiComponents(),
    endMarker: '    # END GENERATED OPERATOR SESSION CONTRACT',
    name: 'Operator Session',
    startMarker: '    # BEGIN GENERATED OPERATOR SESSION CONTRACT',
  },
  {
    content: overviewMetricsOpenApiComponents(),
    endMarker: '    # END GENERATED OVERVIEW METRICS CONTRACT',
    name: 'Overview and metrics',
    startMarker: '    # BEGIN GENERATED OVERVIEW METRICS CONTRACT',
  },
  {
    content: configurationOpenApiComponents(),
    endMarker: '    # END GENERATED CONFIGURATION CONTRACT',
    name: 'configuration',
    startMarker: '    # BEGIN GENERATED CONFIGURATION CONTRACT',
  },
  {
    content: operatorActionsOpenApiComponents(),
    endMarker: '    # END GENERATED OPERATOR ACTION CONTRACT',
    name: 'Operator Action',
    startMarker: '    # BEGIN GENERATED OPERATOR ACTION CONTRACT',
  },
];
const check = process.argv.slice(2).includes('--check');

function scalar(value: unknown): string {
  return typeof value === 'string'
    ? `'${value.replaceAll("'", "''")}'`
    : JSON.stringify(value);
}

function yaml(value: unknown, indentation: number): string {
  const indent = ' '.repeat(indentation);
  if (Array.isArray(value)) {
    const entries: readonly unknown[] = value;
    return entries
      .map((entry) => {
        if (
          entry !== null &&
          typeof entry === 'object' &&
          !Array.isArray(entry)
        ) {
          const [first, ...remaining] = Object.entries(
            entry as Record<string, unknown>,
          );
          if (first !== undefined) {
            const [key, firstValue] = first;
            const firstLine =
              firstValue !== null && typeof firstValue === 'object'
                ? `${indent}- ${key}:\n${yaml(firstValue, indentation + 4)}`
                : `${indent}- ${key}: ${scalar(firstValue)}`;
            return remaining.length === 0
              ? firstLine
              : `${firstLine}\n${yaml(Object.fromEntries(remaining), indentation + 2)}`;
          }
        }
        if (entry !== null && typeof entry === 'object') {
          return `${indent}-\n${yaml(entry, indentation + 2)}`;
        }
        return `${indent}- ${scalar(entry)}`;
      })
      .join('\n');
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => {
        if (entry !== null && typeof entry === 'object') {
          return `${indent}${key}:\n${yaml(entry, indentation + 2)}`;
        }
        return `${indent}${key}: ${scalar(entry)}`;
      })
      .join('\n');
  }
  return `${indent}${scalar(value)}`;
}

function generatedBlock(block: GeneratedContractBlock): string {
  return [block.startMarker, yaml(block.content, 4), block.endMarker].join(
    '\n',
  );
}

function replaceGeneratedBlock(
  source: string,
  block: GeneratedContractBlock,
): string {
  const start = source.indexOf(block.startMarker);
  const end = source.indexOf(block.endMarker);
  if (start < 0 || end < start) {
    throw new Error(`${block.name} contract generation markers are missing.`);
  }
  const suffix = end + block.endMarker.length;
  return `${source.slice(0, start)}${generatedBlock(block)}${source.slice(suffix)}`;
}

function generatedOpenApi(source: string): string {
  return GENERATED_CONTRACT_BLOCKS.reduce(replaceGeneratedBlock, source);
}

function generatedBrowserPolicy(): string {
  return [
    '/**',
    ' * Generated from apps/push-gateway/src/admin-contract/overview-metrics.ts',
    ' * and apps/push-gateway/src/admin-contract/operator-actions.ts.',
    ' * Do not edit manually. Run pnpm nx run push-gateway:generate-admin-contract.',
    ' */',
    'import {',
    '  literal,',
    '  maxLength,',
    '  minLength,',
    '  optional,',
    '  strictObject,',
    '  string,',
    '  union,',
    "} from 'zod/mini';",
    '',
    'export const METRICS_QUERY_POLICY = {',
    `  defaultInterval: '${METRICS_QUERY_POLICY.defaultInterval}',`,
    `  defaultRangeSeconds: ${String(METRICS_QUERY_POLICY.defaultRangeSeconds)},`,
    '  intervalSeconds: {',
    `    day: ${String(METRICS_QUERY_POLICY.intervalSeconds.day)},`,
    `    hour: ${String(METRICS_QUERY_POLICY.intervalSeconds.hour)},`,
    '  },',
    `  intervals: [${METRICS_QUERY_POLICY.intervals.map((interval) => `'${interval}'`).join(', ')}],`,
    `  maximumRangeDays: ${String(METRICS_QUERY_POLICY.maximumRangeDays)},`,
    `  maximumRangeSeconds: ${String(METRICS_QUERY_POLICY.maximumRangeSeconds)},`,
    '} as const;',
    '',
    'export const AUDIT_QUERY_POLICY = {',
    `  defaultPageSize: ${String(AUDIT_QUERY_POLICY.defaultPageSize)},`,
    `  defaultRangeSeconds: ${String(AUDIT_QUERY_POLICY.defaultRangeSeconds)},`,
    '  kinds: [',
    ...AUDIT_ENTRY_KINDS.map((kind) => `    '${kind}',`),
    '  ],',
    `  maximumPageSize: ${String(AUDIT_QUERY_POLICY.maximumPageSize)},`,
    `  maximumRangeDays: ${String(AUDIT_QUERY_POLICY.maximumRangeDays)},`,
    `  maximumRangeSeconds: ${String(AUDIT_QUERY_POLICY.maximumRangeSeconds)},`,
    `  outcomes: [${AUDIT_ENTRY_OUTCOMES.map((outcome) => `'${outcome}'`).join(', ')}],`,
    '} as const;',
    '',
    'export const ADMIN_PROBLEM_CATALOG = {',
    ...Object.entries(ADMIN_PROBLEM_CATALOG).flatMap(([code, definition]) => [
      `  ${code}: {`,
      `    status: ${String(definition.status)},`,
      `    title: ${scalar(definition.title)},`,
      `    type: ${scalar(`/admin/problems/${code}`)},`,
      '  },',
    ]),
    '} as const;',
    '',
    'export const ADMIN_PROBLEM_FIELD_POLICY = {',
    '  detail: {',
    `    maximumLength: ${String(ADMIN_PROBLEM_FIELD_POLICY.detail.maximumLength)},`,
    `    minimumLength: ${String(ADMIN_PROBLEM_FIELD_POLICY.detail.minimumLength)},`,
    '  },',
    '  instance: {',
    `    maximumLength: ${String(ADMIN_PROBLEM_FIELD_POLICY.instance.maximumLength)},`,
    '  },',
    '} as const;',
    '',
    'export type AdminProblemCode = keyof typeof ADMIN_PROBLEM_CATALOG;',
    '',
    '// The inferred type retains the exact generated catalog literals.',
    '// eslint-disable-next-line @typescript-eslint/explicit-function-return-type',
    'const problemVariantSchema = <Code extends AdminProblemCode>(code: Code) => {',
    '  const definition = ADMIN_PROBLEM_CATALOG[code];',
    '  return strictObject({',
    '    code: literal(code),',
    '    detail: optional(',
    '      string().check(',
    '        minLength(ADMIN_PROBLEM_FIELD_POLICY.detail.minimumLength),',
    '        maxLength(ADMIN_PROBLEM_FIELD_POLICY.detail.maximumLength),',
    '      ),',
    '    ),',
    '    instance: optional(',
    '      string().check(',
    '        maxLength(ADMIN_PROBLEM_FIELD_POLICY.instance.maximumLength),',
    '      ),',
    '    ),',
    '    status: literal(definition.status),',
    '    title: literal(definition.title),',
    '    type: literal(definition.type),',
    '  });',
    '};',
    '',
    'export const ADMIN_PROBLEM_SCHEMA = union([',
    ...Object.keys(ADMIN_PROBLEM_CATALOG).map(
      (code) => `  problemVariantSchema('${code}'),`,
    ),
    ']);',
    '',
  ].join('\n');
}

const current = await readFile(openApiPath, 'utf8');
const generated = generatedOpenApi(current);
const currentBrowserPolicy = await readFile(browserPolicyPath, 'utf8');
const generatedPolicy = generatedBrowserPolicy();
const repeatedGenerated = generatedOpenApi(current);
const repeatedGeneratedPolicy = generatedBrowserPolicy();

if (
  generated !== repeatedGenerated ||
  generatedPolicy !== repeatedGeneratedPolicy
) {
  throw new Error(
    'Administration contract generation is not deterministic across repeated projections.',
  );
}

if (check) {
  if (current !== generated || currentBrowserPolicy !== generatedPolicy) {
    throw new Error(
      'Generated administration contracts have drifted; run the generate-admin-contract target.',
    );
  }
  console.info(
    'Generated administration contracts are deterministic and current.',
  );
} else {
  if (current !== generated) {
    await writeFile(openApiPath, generated);
  }
  if (currentBrowserPolicy !== generatedPolicy) {
    await writeFile(browserPolicyPath, generatedPolicy);
  }
  console.info(
    'Generated administration OpenAPI components and browser policy.',
  );
}
