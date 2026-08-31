import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { configurationOpenApiComponents } from '../src/admin-contract/configuration-openapi';
import { operatorSessionOpenApiComponents } from '../src/admin-contract/operator-session-openapi';
import {
  ADMIN_PROBLEM_CODES,
  AUDIT_ENTRY_KINDS,
  AUDIT_ENTRY_OUTCOMES,
  AUDIT_QUERY_POLICY,
} from '../src/admin-contract/operator-actions';
import {
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
    'export const ADMIN_PROBLEM_CODES = [',
    ...ADMIN_PROBLEM_CODES.map((code) => `  '${code}',`),
    '] as const;',
    '',
  ].join('\n');
}

const current = await readFile(openApiPath, 'utf8');
const generated = generatedOpenApi(current);
const currentBrowserPolicy = await readFile(browserPolicyPath, 'utf8');
const generatedPolicy = generatedBrowserPolicy();

if (check) {
  if (current !== generated || currentBrowserPolicy !== generatedPolicy) {
    throw new Error(
      'Generated administration contracts have drifted; run the generate-admin-contract target.',
    );
  }
  console.info('Generated administration contracts are current.');
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
